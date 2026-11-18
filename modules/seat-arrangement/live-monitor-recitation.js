/* Live Monitor now owns attendance and room viewing. Recitation Studio owns
 * recitation controls and reader capture. The legacy toggle opens Studio;
 * reconciliation stops local legacy capture without ending the shared session.
 * Older scan functions remain available for cleanup/backward compatibility. */

'use strict';

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
  function _lmReconcileSessionState() {
    if (_lmRecitationMode) _lmStopRecitationSession();
    _lmStopScannerBListener();
  }
  window._lmToggleRecitationMode = function () {
    _lmReconcileSessionState();
    return window.RecitationStudio.open({classId:_lmClassId});
  };

  function _lmStartRecitationSession(startedAtISO) {
    _lmRecitationMode    = true;
    _lmSessionStartAt    = startedAtISO || new Date().toISOString();
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

  async function _lmSubmitScan(tagId) {
    if (document.body.classList.contains('rs-open')) return;
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

  async function _lmFinalizeScan() {
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

window._lmStopScannerBListener = _lmStopScannerBListener;
