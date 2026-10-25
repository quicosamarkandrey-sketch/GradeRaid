// src/modules/seat-arrangement/live_monitor.js — real-ESM twin of
// ../../../modules/seat-arrangement/live_monitor.js.
// Phase 7 (Stream D), file 27/30 — OWNER of the live-monitor shared state. Original stays untouched.
//
// dependency-map declaresCount is 46 = 18 exports + 24 names that are only `window.X = X` snapshot lines at the bottom
// (23 lets + the LM_SCAN_INACTIVITY_MS const) + 4 file-private declarations (_lmMounted, _lmSubscriberKey, _lmArrivalFeedSeen,
// LM_SEAT_SIZE). The 18 exports: the 17 `window.X = [async] function` handlers (renderClassroomMonitor, unmountClassroomMonitor,
// _lmToggleKioskMode, _lmOnClassChange, _lmOnLayoutChange, _lmOnStrategyChange, _lmToggleSeatTarget, _lmOnOverrideStudentChange,
// _lmOnOverrideStatusChange, _lmOnOverrideNoteInput, _lmToggleOverridePanel, _lmSubmitOverride, _lmOnAwardSearchInput,
// _lmSelectAwardStudentFromSeat, _lmSetAwardPoints, _lmSubmitManualAward, _lmUndoRecitation) -> `export const`, and
// `function _lmSubscribeToStore` -> `export function`. The file-wide 'use strict'; is dropped (modules are strict) and an
// import block takes its place.
//
// THE SHARED-STATE DESIGN (the reason this file is "the hard one"): see the accessor block right after the state
// declarations. Every cross-file `let` keeps its declaration; a window accessor makes sibling modules' bare reads/writes land on
// it. Consequence: live-monitor-recitation.js (file 25) and live-monitor-webnfc.js (file 17), which WRITE those names, need NO
// change, and files 28/29 can keep bare names too. Constraint for the bootstrap: this module must be evaluated before any
// sibling code RUNS (siblings only touch the state inside functions, so import order is irrelevant as long as all modules are loaded).
//
// REAL IMPORTS: AppStore (../core/state-manager.js), toast (../../dom.js), CB_CANVAS_W / CB_CANVAS_H (./classroom_builder.js).
// The latter are needed at LOAD time (the injectStyles IIFE interpolates them into the stylesheet), and a real import guarantees
// classroom_builder is evaluated first — an ordering hazard the classic script tags handled by listing it earlier in index.html.
// BARE (global/window fallback, cluster or behavior): _lmRender / _lmRenderCanvas / _lmRenderSidebar / _lmRenderRecitationSidebar /
// _lmAnimateNewRecitationEntries (live-monitor-render.js, file 28), _lmClearCycle (live-monitor-coldcall.js, file 29),
// _lmReconcileSessionState / _lmStopRecitationSession (live-monitor-recitation.js, file 25 — kept bare so this module does not pull
// the recitation module into its import graph and so the calls stay stub-able), AttendanceService, RecitationService,
// window.getActiveClassIds, window.refreshClassroomData (typeof-guarded).
//
// BINDING NOTE: no export of this file is called bare from inside it; they are reached through inline `onclick` strings and
// nav.js via window (bridge). WRAPPER AUDIT: see HANDOFF #24.
//
// Load-time side effects preserved verbatim: the injectStyles IIFE and (if any) trailing snapshot assignments.

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

import { AppStore } from '../core/state-manager.js';
import { toast } from '../../dom.js';
import { CB_CANVAS_W, CB_CANVAS_H } from './classroom_builder.js';

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

  // CB_CANVAS_W / CB_CANVAS_H intentionally NOT redeclared here — they
  // already exist as top-level globals from classroom_builder.js (loaded
  // earlier in index.html), and live-monitor-render.js already depends on
  // reading those same globals (see its own DEPENDENCIES comment). A local
  // `const CB_CANVAS_W = 1200` here previously collided with that existing
  // top-level declaration: browsers share ONE lexical scope for top-level
  // let/const across every <script> tag in a document, so this threw
  // `SyntaxError: Identifier 'CB_CANVAS_W' has already been declared` the
  // moment this script tag parsed — which meant nothing below this point
  // in live_monitor.js ever ran. Found during Phase 7 build validation
  // (2026-08-09); see EduQuest_Engineering_Refactor_Log.md Phase 7 entry.
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
  // Phase 72 — phone-as-NFC-reader for recitation (mirrors
  // att_scanner_rfid.js's identically-named Web NFC feature for attendance).
  // Independent on/off from the keyboard-wedge listener above: Scanner B
  // (keydown) is for a USB/BT HID dongle plugged into the computer that's
  // presenting on the TV, while this is for a *phone* using its own NFC
  // radio to roam the room — the actual point of Phase 71's session sync.
  let _lmWebNfcActive           = false;
  let _lmWebNfcAbortController  = null;

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

  // ── Phase 7 (Stream D, file 27): cross-file shared-state ACCESSORS ─────────────────────────────────────────────
  // The 23 `let`s above are read AND written by BARE NAME from live-monitor-render.js, -recitation.js, -webnfc.js and
  // -coldcall.js. As classic scripts they all shared one global lexical scope. In this module they are module-private, and an
  // ES importer can never assign to an imported binding, so each one is exposed as an accessor property on window: a sibling's
  // bare `_lmClassId` / `_lmClassId = x` resolves to window._lmClassId and lands on THIS module's binding (live, both
  // directions, Sets and handles included). The declarations above stay byte-identical. The original's trailing
  // `window._lmX = _lmX;` snapshot lines are kept verbatim and are now harmless self-assignments through these setters.
  // (Nothing reads those window snapshots — repo grep — so making them live changes no behavior.) LM_SCAN_INACTIVITY_MS is a
  // never-reassigned const: its trailing snapshot line is already enough. _lmMounted, _lmSubscriberKey, _lmArrivalFeedSeen
  // and LM_SEAT_SIZE are used by this file only, so they stay private.
  [
    ['_lmRecitationMode', () => _lmRecitationMode, v => { _lmRecitationMode = v; }],
    ['_lmClassId', () => _lmClassId, v => { _lmClassId = v; }],
    ['_lmStrategy', () => _lmStrategy, v => { _lmStrategy = v; }],
    ['_lmTargetedSeatIds', () => _lmTargetedSeatIds, v => { _lmTargetedSeatIds = v; }],
    ['_lmSessionStartAt', () => _lmSessionStartAt, v => { _lmSessionStartAt = v; }],
    ['_lmLayoutId', () => _lmLayoutId, v => { _lmLayoutId = v; }],
    ['_lmWebNfcActive', () => _lmWebNfcActive, v => { _lmWebNfcActive = v; }],
    ['_lmOverrideExpanded', () => _lmOverrideExpanded, v => { _lmOverrideExpanded = v; }],
    ['_lmAwardSearch', () => _lmAwardSearch, v => { _lmAwardSearch = v; }],
    ['_lmAwardStudentId', () => _lmAwardStudentId, v => { _lmAwardStudentId = v; }],
    ['_lmAwardPoints', () => _lmAwardPoints, v => { _lmAwardPoints = v; }],
    ['_lmRecitationSeenIds', () => _lmRecitationSeenIds, v => { _lmRecitationSeenIds = v; }],
    ['_lmKioskMode', () => _lmKioskMode, v => { _lmKioskMode = v; }],
    ['_lmResizeListenerAttached', () => _lmResizeListenerAttached, v => { _lmResizeListenerAttached = v; }],
    ['_lmOverrideStudentId', () => _lmOverrideStudentId, v => { _lmOverrideStudentId = v; }],
    ['_lmOverrideStatus', () => _lmOverrideStatus, v => { _lmOverrideStatus = v; }],
    ['_lmOverrideNote', () => _lmOverrideNote, v => { _lmOverrideNote = v; }],
    ['_lmRecitationKeyHandler', () => _lmRecitationKeyHandler, v => { _lmRecitationKeyHandler = v; }],
    ['_lmScanBuffer', () => _lmScanBuffer, v => { _lmScanBuffer = v; }],
    ['_lmScanInactivityTimer', () => _lmScanInactivityTimer, v => { _lmScanInactivityTimer = v; }],
    ['_lmWebNfcAbortController', () => _lmWebNfcAbortController, v => { _lmWebNfcAbortController = v; }],
    ['_lmCycleTimeout', () => _lmCycleTimeout, v => { _lmCycleTimeout = v; }],
    ['_lmCycleInterval', () => _lmCycleInterval, v => { _lmCycleInterval = v; }],
  ].forEach(([name, get, set]) => Object.defineProperty(window, name, { get, set, enumerable: true, configurable: true }));

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

  export const renderClassroomMonitor = function () {
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

    // Phase 71 — pick up a recitation session already running on another
    // device (e.g. the phone started it before this computer's Live
    // Monitor was even opened) before the very first paint.
    _lmReconcileSessionState();

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

  export const unmountClassroomMonitor = function () {
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
  export const _lmToggleKioskMode = function () {
    _lmKioskMode = !_lmKioskMode;
    document.body.classList.toggle('lm-kiosk-mode', _lmKioskMode);

    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  export function _lmSubscribeToStore() {
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
        // Phase 71 — pick up a session started/stopped on another device
        // before repainting, so this paint already reflects the right mode
        // instead of flickering into it on the next event.
        _lmReconcileSessionState();
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


// ── Render layer — owned by live-monitor-render.js (Phase 6) ─────────────────
// _lmRender/_lmScaleCanvas used to live here — moved to their own file, see
// that file's header. Every call site below is unchanged.


  export const _lmOnClassChange = function (classId) {
    _lmClassId = classId;
    _lmTargetedSeatIds.clear();
    // Phase 71 — the class just switched, so re-check whether ITS session
    // (not the previous class's) is active anywhere.
    _lmReconcileSessionState();
    const state = AppStore.getState();
    const layoutsForClass = (state.classroomLayouts || []).filter(l => l.classId === classId);
    _lmLayoutId = layoutsForClass[0] ? layoutsForClass[0].id : null;
    const page = document.getElementById('a-classroom-monitor');
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  export const _lmOnLayoutChange = function (layoutId) {
    _lmLayoutId = layoutId || null;
    _lmTargetedSeatIds.clear();
    _lmRenderCanvas();
    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
  };

  // Changing strategy always resets targeting — simplest, least-surprising
  // rule: switching to spatial_block always starts from a clean slate, and
  // switching away never leaves a stale selection lurking for next time.
  export const _lmOnStrategyChange = function (strategy) {
    _lmStrategy = strategy;
    _lmTargetedSeatIds.clear();
    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

// (_lmRenderCanvas() itself now lives in live-monitor-render.js.)


  // Toggles a seat's membership in the spatial_block target set, then does a
  // lightweight repaint: just the seat's own class + the toolbar's count
  // badge/button state, not a full re-render (keeps dropdown focus, scroll
  // position, etc. undisturbed).
  export const _lmToggleSeatTarget = function (seatId) {
    if (_lmTargetedSeatIds.has(seatId)) _lmTargetedSeatIds.delete(seatId);
    else _lmTargetedSeatIds.add(seatId);

    const seatEl = document.querySelector(`.lm-seat[data-seat-id="${seatId}"]`);
    if (seatEl) seatEl.classList.toggle('targeted', _lmTargetedSeatIds.has(seatId));

    const countEl = document.querySelector('.lm-target-count');
    if (countEl) countEl.textContent = String(_lmTargetedSeatIds.size);

    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
  };

// (_lmRenderSidebar/_lmRenderAttendanceSidebar/_lmOverridePanelHtml now live
// in live-monitor-render.js.)


  export const _lmOnOverrideStudentChange = function (studentId) {
    _lmOverrideStudentId = studentId;
    _lmRenderSidebar();
  };

  export const _lmOnOverrideStatusChange = function (status) {
    _lmOverrideStatus = status;
  };

  export const _lmOnOverrideNoteInput = function (value) {
    _lmOverrideNote = value;
    // Repainting the sidebar wholesale (on the next AppStore event) would
    // otherwise drop focus mid-sentence — same fix as the recitation award
    // search box below: restore focus and cursor position after any repaint
    // that happens to catch this input while it's active.
    const input = document.getElementById('lm-override-note');
    if (input) { input.focus(); const v = input.value; input.value = ''; input.value = v; }
  };

  export const _lmToggleOverridePanel = function () {
    _lmOverrideExpanded = !_lmOverrideExpanded;
    _lmRenderSidebar();
  };

  export const _lmSubmitOverride = async function () {
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


// (_lmFeedItem/_lmRenderRecitationSidebar/_lmRecitationFeedItem now live in
// live-monitor-render.js.)


  // Search box + seat-click + points selection — all lightweight repaints of
  // just the sidebar, not the whole page (keeps search input focus intact).
  export const _lmOnAwardSearchInput = function (value) {
    _lmAwardSearch = value;
    _lmRenderRecitationSidebar();
    // Repainting the sidebar wholesale drops focus from the search input —
    // restore it and put the cursor back at the end so typing feels continuous.
    const input = document.getElementById('lm-award-search');
    if (input) { input.focus(); const v = input.value; input.value = ''; input.value = v; }
  };

  export const _lmSelectAwardStudentFromSeat = function (studentId) {
    _lmAwardStudentId = studentId;
    if (_lmRecitationMode) _lmRenderRecitationSidebar();
  };

  export const _lmSetAwardPoints = function (n) {
    _lmAwardPoints = n;
    if (_lmRecitationMode) _lmRenderRecitationSidebar();
  };

  export const _lmSubmitManualAward = async function () {
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

  export const _lmUndoRecitation = async function (logId) {
    const result = await RecitationService.undoRecitation(logId);
    if (!result.ok) { toast('⚠️ ' + result.error, '#ffb95f'); return; }
    toast('↩️ Recitation entry undone', '#93c5fd');
    // Same as above — the AppStore event drives the repaint.
  };


// (_lmAnimateNewRecitationEntries/_lmSpawnFloatingPoint now live in
// live-monitor-render.js.)


  // ── Recitation session lifecycle + Scanner B — owned by
  // live-monitor-recitation.js (Phase 6) ────────────────────────────────────
  // _lmReconcileSessionState/window._lmToggleRecitationMode/
  // _lmStartRecitationSession/_lmStopRecitationSession/
  // _lmStartScannerBListener/_lmStopScannerBListener/_lmSubmitScan/
  // _lmFinalizeScan used to live here (~140 lines) — moved to their own
  // file (see that file's header). Every call site elsewhere is unchanged.

  // ── Phone-as-NFC-reader (Web NFC) — owned by live-monitor-webnfc.js
  // (Phase 6) ───────────────────────────────────────────────────────────────
  // _lmWebNfcSupported/window._lmToggleWebNfc/_lmStartWebNfcCapture/
  // _lmStopWebNfcCapture/_lmRefreshWebNfcButton used to live here
  // (~75 lines) — moved to their own file for the same reason.

  // ── Cold Call: random present/late student selector — owned by
  // live-monitor-coldcall.js (Phase 6) ──────────────────────────────────────
  // window._lmStartColdCall/_lmClearCycle/_lmLandOnWinner/_lmShowSpotlight
  // used to live here (~190 lines) — moved to their own file for the same
  // reason. This was the last remaining subsystem in live_monitor.js beyond
  // core state/mount/subscribe/override — every "screen mode" this file
  // supports now has its own file.

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._lmRecitationMode = _lmRecitationMode;
window._lmClassId = _lmClassId;
window._lmStrategy = _lmStrategy;
window._lmTargetedSeatIds = _lmTargetedSeatIds;
window._lmSessionStartAt = _lmSessionStartAt;
window._lmLayoutId = _lmLayoutId;
window._lmWebNfcActive = _lmWebNfcActive;
window._lmOverrideExpanded = _lmOverrideExpanded;
window._lmAwardSearch = _lmAwardSearch;
window._lmAwardStudentId = _lmAwardStudentId;
window._lmAwardPoints = _lmAwardPoints;
window._lmRecitationSeenIds = _lmRecitationSeenIds;
window._lmKioskMode = _lmKioskMode;
window._lmResizeListenerAttached = _lmResizeListenerAttached;
window._lmOverrideStudentId = _lmOverrideStudentId;
window._lmOverrideStatus = _lmOverrideStatus;
window._lmOverrideNote = _lmOverrideNote;
window._lmRecitationKeyHandler = _lmRecitationKeyHandler;
window._lmScanBuffer = _lmScanBuffer;
window._lmScanInactivityTimer = _lmScanInactivityTimer;
window.LM_SCAN_INACTIVITY_MS = LM_SCAN_INACTIVITY_MS;
window._lmWebNfcAbortController = _lmWebNfcAbortController;
window._lmCycleTimeout = _lmCycleTimeout;
window._lmCycleInterval = _lmCycleInterval;
