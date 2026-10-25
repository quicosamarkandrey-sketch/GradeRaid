// src/modules/seat-arrangement/live-monitor-webnfc.js — real-ESM twin of
// ../../../modules/seat-arrangement/live-monitor-webnfc.js.
// Phase 7 (Stream D), file 17/30. Original stays untouched.
//
// All 5 top-level declared symbols exported, matching declaresCount 5 exactly
// (dist/dependency-map.json): 4 real declarations (_lmWebNfcSupported,
// _lmStartWebNfcCapture [async], _lmStopWebNfcCapture, _lmRefreshWebNfcButton —
// keyword swap only) plus the one `window._lmToggleWebNfc = function` assignment
// converted to `export const _lmToggleWebNfc = function`. The original's own
// 2-line trailing "Phase 7 explicit window exports" block is kept VERBATIM.
// The file-wide `'use strict';` directive is dropped (ES modules are always
// strict, so semantics are identical); the import block sits where it was.
// Everything else — including the body's historical 2-space indent — is
// byte-identical to the original.
//
// REAL IMPORT: toast (../../dom.js).
//
// BARE (window / global-scope fallback), per the global rule:
//   _lmSubmitScan   — live-monitor-recitation.js (file 25, not yet converted;
//                     CYCLE: recitation calls _lmStopWebNfcCapture back).
//   _rfidNormalizeTagId — att_scanner_rfid.js, kept bare because its
//                     `typeof === 'function'` guard is behavior.
//   _lmRecitationMode, _lmWebNfcActive, _lmWebNfcAbortController — the shared
//                     module state declared by live_monitor.js (below).
//
// SHARED STATE (disclosed; same family as classroom_builder.js HANDOFF #9, but
// the opposite direction): those three `let`s are declared at the TOP LEVEL of
// the classic script live_monitor.js, i.e. in the global lexical environment,
// which ES module code resolves by bare name just like classic scripts do. So
// TODAY (classic live_monitor.js + this module) reads AND writes still hit the
// one real binding — behavior identical to the original. The hazard arrives
// when live_monitor.js (file 27) becomes a module: its lets turn module-scoped
// (invisible here) and an importer cannot assign to an imported binding. File 27
// must therefore decide how this file's two WRITES (_lmWebNfcActive,
// _lmWebNfcAbortController) are served (e.g. owner-exported setters, or keeping
// these two on a shared object) and revisit this twin then. See HANDOFF #10.
//
// BINDING NOTE: none of the 5 names is reassigned anywhere outside this file
// (repo-wide scan). Consumers: live-monitor-render.js calls _lmWebNfcSupported()
// bare and window._lmToggleWebNfc(); live-monitor-recitation.js calls
// _lmStopWebNfcCapture() bare — all resolve through window via the bridge.

// ─────────────────────────────────────────────────────────────────────────────
// LIVE MONITOR — phone-as-NFC-reader (Web NFC)
//
// Phase 6 (Decompose God Files) extraction from live_monitor.js. Owns the
// optional "use this phone as an NFC reader" capture mode — entirely
// additive to Scanner B's keyboard-wedge listener (live-monitor-recitation.js),
// same posture as att_scanner_rfid.js's identically-named feature: it never
// touches the keyboard-wedge buffer/handler, it only ever calls the same
// _lmSubmitScan(tagId) the keyboard path calls, so everything downstream is
// identical no matter which physical reader produced the tag. No behavior
// change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: every function here reads/writes the shared
// module state declared in live_monitor.js. Its only cross-file call is
// _lmSubmitScan() (live-monitor-recitation.js) — one direction, by design,
// per the file's own original header comment (kept above).
//
// Exports: _lmWebNfcSupported(), window._lmToggleWebNfc(),
//   _lmStartWebNfcCapture(), _lmStopWebNfcCapture(), _lmRefreshWebNfcButton()
//
// DEPENDENCIES: the module state declared in live_monitor.js, toast(),
// _lmSubmitScan() (live-monitor-recitation.js) — all globals already
// available wherever this file loads, same as when this code lived inside
// live_monitor.js.
// ─────────────────────────────────────────────────────────────────────────────

import { toast } from '../../dom.js';


  // ── Phone-as-NFC-reader (Web NFC) ─────────────────────────────────────────
  // Entirely additive to the keyboard-wedge listener above, same posture as
  // att_scanner_rfid.js's identically-named feature: it never touches
  // _lmScanBuffer or the keydown handler, it only ever calls the same
  // _lmSubmitScan(tagId) the keyboard path calls, so everything downstream
  // (RecitationService, AppStore, the realtime echo to other devices) is
  // identical no matter which physical reader produced the tag. tagId is
  // normalized via att_scanner_rfid.js's _rfidNormalizeTagId() (global,
  // loaded on every page — see that file's header comment for why phone
  // Web NFC reads and USB keyboard-wedge reads of the SAME card need
  // normalizing into one canonical id before either can look up a student).

  export function _lmWebNfcSupported() {
    return typeof window !== 'undefined' && 'NDEFReader' in window;
  }

  export const _lmToggleWebNfc = function () {
    if (_lmWebNfcActive) {
      _lmStopWebNfcCapture();
    } else {
      _lmStartWebNfcCapture();
    }
  };

  export async function _lmStartWebNfcCapture() {
    if (!_lmWebNfcSupported()) return;
    try {
      _lmWebNfcAbortController = new AbortController();
      const ndef = new NDEFReader();
      // Must be called from a user gesture (the button's onclick) — this is
      // a browser security requirement, not something we can work around.
      await ndef.scan({ signal: _lmWebNfcAbortController.signal });

      _lmWebNfcActive = true;
      _lmRefreshWebNfcButton();
      toast('📱 Phone NFC reader armed — hold cards to the back of the phone', '#4edea3');

      ndef.onreading = (event) => {
        if (!_lmRecitationMode) return;
        const rawTagId = event.serialNumber;
        if (!rawTagId) return;
        const tagId = (typeof _rfidNormalizeTagId === 'function') ? _rfidNormalizeTagId(rawTagId) : rawTagId;
        _lmSubmitScan(tagId);
      };

      ndef.onreadingerror = () => {
        toast('⚠️ Could not read that tag — try again', '#ffd166');
      };
    } catch (err) {
      _lmWebNfcActive = false;
      _lmWebNfcAbortController = null;
      _lmRefreshWebNfcButton();
      toast('Could not start phone NFC: ' + (err && err.message ? err.message : err), '#ffb4ab');
    }
  }

  export function _lmStopWebNfcCapture() {
    if (_lmWebNfcAbortController) {
      _lmWebNfcAbortController.abort();
      _lmWebNfcAbortController = null;
    }
    _lmWebNfcActive = false;
    _lmRefreshWebNfcButton();
  }

  export function _lmRefreshWebNfcButton() {
    const btn = document.getElementById('lm-webnfc-toggle');
    if (!btn) return;
    btn.classList.toggle('active', _lmWebNfcActive);
    btn.textContent = _lmWebNfcActive ? '📱 NFC On — Roaming' : '📱 Use This Phone as Reader';
    btn.title = _lmWebNfcActive
      ? 'Stop using this phone as an NFC reader'
      : 'Use this phone as an NFC reader — tap to arm, then hold cards to the back of the phone';
  }

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._lmWebNfcSupported = _lmWebNfcSupported;
window._lmStopWebNfcCapture = _lmStopWebNfcCapture;
