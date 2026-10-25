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

'use strict';


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

  function _lmWebNfcSupported() {
    return typeof window !== 'undefined' && 'NDEFReader' in window;
  }

  window._lmToggleWebNfc = function () {
    if (_lmWebNfcActive) {
      _lmStopWebNfcCapture();
    } else {
      _lmStartWebNfcCapture();
    }
  };

  async function _lmStartWebNfcCapture() {
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

  function _lmStopWebNfcCapture() {
    if (_lmWebNfcAbortController) {
      _lmWebNfcAbortController.abort();
      _lmWebNfcAbortController = null;
    }
    _lmWebNfcActive = false;
    _lmRefreshWebNfcButton();
  }

  function _lmRefreshWebNfcButton() {
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
