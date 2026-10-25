(() => {
  // src/dom.js
  function toast(msg, color = "#4edea3") {
    const el = document.getElementById("toast");
    el.style.display = "block";
    el.style.borderColor = color + "55";
    el.style.boxShadow = `0 0 20px ${color}33`;
    el.innerHTML = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = "none", 2800);
  }

  // src/modules/seat-arrangement/live-monitor-webnfc.js
  function _lmWebNfcSupported() {
    return typeof window !== "undefined" && "NDEFReader" in window;
  }
  var _lmToggleWebNfc = function() {
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
      await ndef.scan({ signal: _lmWebNfcAbortController.signal });
      _lmWebNfcActive = true;
      _lmRefreshWebNfcButton();
      toast("\u{1F4F1} Phone NFC reader armed \u2014 hold cards to the back of the phone", "#4edea3");
      ndef.onreading = (event) => {
        if (!_lmRecitationMode) return;
        const rawTagId = event.serialNumber;
        if (!rawTagId) return;
        const tagId = typeof _rfidNormalizeTagId === "function" ? _rfidNormalizeTagId(rawTagId) : rawTagId;
        _lmSubmitScan(tagId);
      };
      ndef.onreadingerror = () => {
        toast("\u26A0\uFE0F Could not read that tag \u2014 try again", "#ffd166");
      };
    } catch (err) {
      _lmWebNfcActive = false;
      _lmWebNfcAbortController = null;
      _lmRefreshWebNfcButton();
      toast("Could not start phone NFC: " + (err && err.message ? err.message : err), "#ffb4ab");
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
    const btn = document.getElementById("lm-webnfc-toggle");
    if (!btn) return;
    btn.classList.toggle("active", _lmWebNfcActive);
    btn.textContent = _lmWebNfcActive ? "\u{1F4F1} NFC On \u2014 Roaming" : "\u{1F4F1} Use This Phone as Reader";
    btn.title = _lmWebNfcActive ? "Stop using this phone as an NFC reader" : "Use this phone as an NFC reader \u2014 tap to arm, then hold cards to the back of the phone";
  }
  window._lmWebNfcSupported = _lmWebNfcSupported;
  window._lmStopWebNfcCapture = _lmStopWebNfcCapture;

  // build/bridges/live-monitor-webnfc.bridge.js
  window._lmWebNfcSupported = _lmWebNfcSupported;
  window._lmToggleWebNfc = _lmToggleWebNfc;
  window._lmStartWebNfcCapture = _lmStartWebNfcCapture;
  window._lmStopWebNfcCapture = _lmStopWebNfcCapture;
  window._lmRefreshWebNfcButton = _lmRefreshWebNfcButton;
})();
