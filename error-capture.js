// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR CAPTURE — Phase 2 of ADMIN_SYSTEM_HEALTH.md
//
// window.onerror + unhandledrejection → log_client_error() RPC, fire-and-
// forget (same posture as wbcApplyDamage — never lets a logging failure
// propagate or throw a second error on top of the one being reported).
//
// LOAD ORDER: this is loaded FIRST in index.html — before the Supabase SDK
// and db-service.js — so it can catch boot-time errors too, including a
// broken db-service.js itself. That means DBService does not exist yet when
// this file runs. Rather than depend on SystemHealthService (modules/admin/
// system-health-service.js, which also doesn't exist yet at this point in
// the script order), this calls the log_client_error RPC directly, and
// buffers anything caught before DBService.rpc becomes available. The
// buffer is flushed by a short poll, which clears itself once DBService
// shows up (or just never fires again if it never does — nothing to leak
// past page load).
//
// Only genuine runtime errors are reported: window.addEventListener('error')
// ignores resource-load errors (missing <img>/<script>/<link>), which fire
// as 'error' events with no `.error` property — those aren't JS errors and
// aren't what this feature is for.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var _queue = [];
  var _flushTimer = null;

  function _rpcAvailable() {
    return typeof DBService !== 'undefined' && typeof DBService.rpc === 'function';
  }

  function _sendNow(entry) {
    DBService.rpc('log_client_error', {
      p_message: entry.message,
      p_stack: entry.stack,
      p_source: entry.source,
      p_user_agent: entry.userAgent,
      p_url: entry.url,
    }).catch(function () { /* fire-and-forget: swallow, never throw from here */ });
  }

  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setInterval(function () {
      if (!_rpcAvailable()) return;
      clearInterval(_flushTimer);
      _flushTimer = null;
      var pending = _queue;
      _queue = [];
      pending.forEach(_sendNow);
    }, 250);
  }

  function _capture(message, stack, source) {
    try {
      var entry = {
        message: String(message || 'Unknown error').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 8000) : null,
        source: source,
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
        url: (typeof location !== 'undefined' && location.href) || null,
      };
      if (_rpcAvailable()) {
        _sendNow(entry);
      } else {
        _queue.push(entry);
        _scheduleFlush();
      }
    } catch (e) {
      // Never let the error handler itself throw.
    }
  }

  window.onerror = function (message, source, lineno, colno, error) {
    // Cross-origin script errors report as "Script error." with no `error`
    // object and no useful stack — still worth a row (source url + line are
    // in `message`/`source` params), just without a stack trace.
    _capture(
      (error && error.message) || message,
      error && error.stack,
      'onerror'
    );
    return false; // don't suppress the browser's own console reporting
  };

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = (reason && (reason.message || String(reason))) || 'Unhandled promise rejection';
    var stack = reason && reason.stack;
    _capture(message, stack, 'unhandledrejection');
  });
})();
