// src/modules/seat-arrangement/live-monitor-recitation.js — real-ESM twin of
// ../../../modules/seat-arrangement/live-monitor-recitation.js.
// Phase 7 (Stream D), file 25/30. Original stays untouched.
//
// All 8 top-level declared symbols exported, matching declaresCount 8 exactly (dist/dependency-map.json): 7 real
// declarations (_lmReconcileSessionState, _lmStartRecitationSession, _lmStopRecitationSession,
// _lmStartScannerBListener, _lmStopScannerBListener, _lmSubmitScan [async], _lmFinalizeScan [async] — keyword swap only)
// plus the one `window._lmToggleRecitationMode = async function` assignment converted to `export const
// _lmToggleRecitationMode = async function`. The original's own 3-line trailing "Phase 7 explicit window exports"
// block (window._lmReconcileSessionState / _lmStopRecitationSession / _lmSubmitScan = ...) is kept VERBATIM: it assigns the
// module-local bindings to window exactly as before. The file-wide `'use strict';` directive is dropped (ES modules are
// always strict); the import block takes its place. Everything else — including the body's historical 2-space indent and
// the trailing code — is byte-identical to the original.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), toast (../../dom.js).
//
// BARE (window / global-scope fallback), per the global rule:
//   RecitationService   — recitation-service.js (file 5). KEPT BARE ON PURPOSE: the `typeof RecitationService ===
//                         'undefined'` guard in _lmReconcileSessionState is behavior (a no-op until the service exists).
//   _lmRender           — live-monitor-render.js (file 28, not yet converted; CYCLE with live_monitor.js).
//   _lmStopWebNfcCapture— live-monitor-webnfc.js (file 17; the other direction of the webnfc <-> recitation call pair,
//                         resolved through window via its bridge, as file 17's header describes).
//   window.getActiveClassIds (explicitly via window in the source).
//   Shared module state declared by live_monitor.js (file 27): _lmClassId, _lmRecitationMode, _lmSessionStartAt,
//   _lmRecitationSeenIds, _lmAwardStudentId, _lmAwardSearch, _lmAwardPoints, _lmStrategy, _lmTargetedSeatIds,
//   _lmOverrideExpanded, _lmRecitationKeyHandler, _lmScanBuffer, _lmScanInactivityTimer, LM_SCAN_INACTIVITY_MS.
//
// SHARED STATE (disclosed; same family as HANDOFF #10 / file 17): those are TOP-LEVEL `let`/`const` of the classic script
// live_monitor.js, i.e. in the global lexical environment, which ES module code resolves by bare name just like classic
// scripts do. So TODAY (classic live_monitor.js + this module) reads AND writes still hit the one real binding — behavior
// identical. This file WRITES 11 of them (_lmRecitationMode, _lmSessionStartAt, _lmRecitationSeenIds, _lmAwardStudentId,
// _lmAwardSearch, _lmAwardPoints, _lmStrategy, _lmOverrideExpanded, _lmRecitationKeyHandler, _lmScanBuffer,
// _lmScanInactivityTimer). The hazard arrives when live_monitor.js (file 27) becomes a module: its lets turn
// module-scoped and an importer cannot assign to an imported binding, so file 27 must serve these writes (owner-exported
// setters, or a shared state object) and BOTH this twin and file 17's must be revisited then.
//
// BINDING NOTE: internal calls between this file's own functions (_lmStartRecitationSession, _lmStopRecitationSession,
// _lmStartScannerBListener, _lmStopScannerBListener, _lmFinalizeScan, _lmSubmitScan) now resolve lexically instead of through
// window. WRAPPER AUDIT (tools/audit-patched-exports.js + repo grep): see HANDOFF #22.

// ─────────────────────────────────────────────────────────────────────────────
// LIVE MONITOR — recitation session lifecycle + Scanner B (keyboard-wedge
// RFID)
//
// Phase 6 (Decompose God Files) extraction from live_monitor.js. Owns
// cross-device recitation-session reconciliation (auto entering/exiting
// Recitation Mode to match the authoritative RecitationService session),
// starting/stopping a session locally, and the keyboard-wedge scanner
// listener (buffers keystrokes between an RFID reader's rapid keydown
// events, on inactivity submits the buffered tag). No behavior change —
// every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: every function here reads/writes the shared
// module state declared in live_monitor.js (same shared top-level `let`
// bindings every other Phase 6 split in this file already relies on — see
// live-monitor-render.js's header for the full explanation). The one
// cross-file call — _lmStopWebNfcCapture() inside window._lmToggleRecitationMode,
// "don't leave the phone's NFC radio armed after the session ends" — is a
// single defensive cleanup call into live-monitor-webnfc.js, not mutual
// coupling, so these stayed as separate files rather than combined the way
// campaign_engine.js's reveal+dialogue beats were (where BOTH sides called
// into each other's cleanup symmetrically).
//
// Exports: _lmReconcileSessionState(), window._lmToggleRecitationMode(),
//   _lmStartRecitationSession(), _lmStopRecitationSession(),
//   _lmStartScannerBListener(), _lmStopScannerBListener(), _lmSubmitScan(),
//   _lmFinalizeScan()
//
// DEPENDENCIES: the module state declared in live_monitor.js, RecitationService,
// AppStore, toast(), _lmRender(), _lmStopWebNfcCapture() (live-monitor-webnfc.js)
// — all globals already available wherever this file loads, same as when
// this code lived inside live_monitor.js.
// ─────────────────────────────────────────────────────────────────────────────

import { AppStore } from '../core/state-manager.js';
import { toast } from '../../dom.js';

  // ── Recitation session lifecycle + Scanner B ────────────────────────────────

  // Phase 71 — cross-device "Start Recitation Session" sync. Compares this
  // tab's local recitation-mode flag against the authoritative
  // RecitationService.getActiveSession() (synced from Supabase's
  // recitation_sessions table — see db-service.js/recitation-service.js)
  // and auto-enters/exits recitation mode to match. Called on mount (picks
  // up a session that was already running before this device opened Live
  // Monitor) and on every relevant store update (picks up a session
  // started/stopped from ANOTHER device while this one is already open).
  // _lmStartRecitationSession()/_lmStopRecitationSession() are pure local
  // UI state — neither calls AppStore.updateState() — so this never
  // re-enters itself through the subscriber it's called from.
  export function _lmReconcileSessionState() {
    if (!_lmClassId || typeof RecitationService === 'undefined') return;
    const active = RecitationService.getActiveSession(_lmClassId);
    if (active && !_lmRecitationMode) {
      // Join using the OTHER device's authoritative start time, not a fresh
      // timestamp of our own, so both devices score the exact same window.
      _lmStartRecitationSession(active.startedAt);
    } else if (!active && _lmRecitationMode) {
      _lmStopRecitationSession();
    }
  }

  export const _lmToggleRecitationMode = async function () {
    if (_lmRecitationMode) {
      // Confirm before stopping — this now ends the session on every
      // device it's synced to (Phase 71), not just this tab, so an
      // accidental click has a bigger blast radius than it used to.
      if (!confirm('End this recitation session? This will end it on every device it\'s synced to.')) return;
      const result = await RecitationService.stopSession(_lmClassId);
      if (!result.ok) { toast('⚠️ ' + result.error, '#ffb95f'); return; }
      _lmStopRecitationSession();
    } else {
      const result = await RecitationService.startSession(_lmClassId);
      if (!result.ok) { toast('⚠️ ' + result.error, '#ffb95f'); return; }
      // result.session.startedAt is authoritative — idempotent server-side,
      // so if another device juuust started this same session, we join
      // THEIRS instead of stamping our own new start time.
      _lmStartRecitationSession(result.session ? result.session.startedAt : null);
    }
    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  export function _lmStartRecitationSession(startedAtISO) {
    _lmRecitationMode    = true;
    _lmSessionStartAt    = startedAtISO || new Date().toISOString();
    _lmRecitationSeenIds = new Set();
    _lmAwardStudentId    = null;
    _lmAwardSearch       = '';
    _lmAwardPoints       = 1;
    _lmStartScannerBListener();
    toast('🎤 Recitation session started', '#4edea3');
  }

  export function _lmStopRecitationSession() {
    if (!_lmRecitationMode) return; // safe no-op — lets unmount call this unconditionally
    _lmRecitationMode = false;
    _lmStopScannerBListener();
    _lmStopWebNfcCapture(); // Phase 72 — don't leave the phone's NFC radio armed after the session ends
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
  export function _lmStartScannerBListener() {
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

  export function _lmStopScannerBListener() {
    if (_lmRecitationKeyHandler) {
      document.removeEventListener('keydown', _lmRecitationKeyHandler);
      _lmRecitationKeyHandler = null;
    }
    clearTimeout(_lmScanInactivityTimer);
    _lmScanInactivityTimer = null;
    _lmScanBuffer = '';
  }

  export async function _lmSubmitScan(tagId) {
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

  export async function _lmFinalizeScan() {
    const tagId = _lmScanBuffer.trim();
    _lmScanBuffer = '';
    clearTimeout(_lmScanInactivityTimer);
    await _lmSubmitScan(tagId);
  }

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._lmReconcileSessionState = _lmReconcileSessionState;
window._lmStopRecitationSession = _lmStopRecitationSession;
window._lmSubmitScan = _lmSubmitScan;
