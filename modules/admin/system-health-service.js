// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/system-health-service.js
//  Service layer for the admin System Health panel (Phase 2 of
//  ADMIN_SYSTEM_HEALTH.md). Repository-pattern wrapper around the three
//  RPC groups added in supabase/phase69_system_health_analytics.sql, same
//  shape as AuditLogService.
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  no render layer calls DBService.rpc() directly for system-health data.
//  It calls SystemHealthService.<method>(...).
//
//  WHAT'S HERE
//    touchPresence()      — the heartbeat write (own row only, server-side).
//    getUserCounts()       — admin-only read: total/online users by role.
//    getErrorLogs()        — admin-only read: filterable client error log.
//    resolveErrorLog()     — admin-only write: toggles the resolved flag.
//    logClientError()      — anon/authenticated write, fire-and-forget, same
//                             posture as wbcApplyDamage. error-capture.js
//                             (loaded much earlier in index.html, before
//                             DBService exists) calls the RPC directly
//                             instead of this — see that file's own note —
//                             but any render-layer code that wants to log a
//                             handled error should call this, not the RPC.
//    startPresenceHeartbeat() / stopPresenceHeartbeat() — the heartbeat's
//    interval lifecycle. Called from auth.js's bootApp()/doLogout(), the
//    same pairing WBC.refreshInterval already uses elsewhere in that file.
//    Colocated here (rather than left inline in auth.js) since the pause-
//    on-hidden-tab logic is presence-specific bookkeeping, not auth
//    bookkeeping — auth.js just starts/stops it at the right lifecycle
//    points, same as it does for WBC's own interval.
// ═══════════════════════════════════════════════════════════════════════════════

window.SystemHealthService = (function () {
  'use strict';

  const HEARTBEAT_INTERVAL_MS = 60000; // matches the "proposed: every 60s" in the phase doc

  let _heartbeatTimer = null;
  let _visibilityHandler = null;

  /**
   * touchPresence() → Promise<{ok, timestamp?, error?}>
   * Writes the caller's own last_seen_at. No params — auth.uid() is
   * resolved server-side, never passed in.
   */
  async function touchPresence() {
    const { data, error } = await DBService.rpc('touch_presence', {});
    if (error) return { ok: false, error: error.message || 'Could not update presence.' };
    return { ok: true, timestamp: data };
  }

  /**
   * getUserCounts() → Promise<{ok, counts?, error?}>
   * counts = { total_users, total_admins, total_teachers, total_students, online_now }
   * Admin-only server-side; a non-admin caller gets back an RPC error.
   */
  async function getUserCounts() {
    const { data, error } = await DBService.rpc('get_admin_user_counts', {});
    if (error) return { ok: false, error: error.message || 'Could not load user counts.' };
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, counts: row || null };
  }

  /**
   * getErrorLogs({resolved?, role?, limit?}) → Promise<{ok, rows?, error?}>
   * Admin-only server-side. limit is clamped 1-1000 by the RPC itself.
   */
  async function getErrorLogs({ resolved = null, role = null, limit = 200 } = {}) {
    const { data, error } = await DBService.rpc('get_client_error_logs', {
      p_resolved: resolved,
      p_role: role,
      p_limit: limit,
    });
    if (error) return { ok: false, error: error.message || 'Could not load client error logs.' };
    return { ok: true, rows: data || [] };
  }

  /**
   * resolveErrorLog({id, resolved?}) → Promise<{ok, row?, error?}>
   * Admin-only server-side. resolved defaults to true (the common "mark
   * resolved" case); pass false to un-resolve.
   */
  async function resolveErrorLog({ id, resolved = true }) {
    const { data, error } = await DBService.rpc('resolve_client_error_log', {
      p_id: id,
      p_resolved: resolved,
    });
    if (error) return { ok: false, error: error.message || 'Could not update this error log.' };
    return { ok: true, row: data };
  }

  /**
   * logClientError({message, stack?, source?, userAgent?, url?}) → Promise<{ok, error?}>
   * Fire-and-forget, same posture as wbcApplyDamage: never throws. Safe to
   * call with no session (log_client_error() is granted to anon too).
   * error-capture.js's window.onerror/unhandledrejection hooks call the RPC
   * directly rather than this function, since they load and can fire before
   * this file exists — see error-capture.js's header note. This wrapper is
   * for any other render-layer code that wants to log a handled error.
   */
  async function logClientError({ message, stack = null, source = null, userAgent = null, url = null }) {
    try {
      const { error } = await DBService.rpc('log_client_error', {
        p_message: message,
        p_stack: stack,
        p_source: source,
        p_user_agent: userAgent,
        p_url: url,
      });
      if (error) {
        console.warn('[SystemHealthService] log_client_error RPC failed:', error);
        return { ok: false, error };
      }
      return { ok: true };
    } catch (e) {
      console.warn('[SystemHealthService] log_client_error threw:', e);
      return { ok: false, error: e };
    }
  }

  // ── Presence heartbeat lifecycle ────────────────────────────────────────

  function _tick() {
    touchPresence().catch(function (e) {
      console.warn('[SystemHealthService] presence heartbeat failed:', e);
    });
  }

  /**
   * startPresenceHeartbeat() — call once per login (bootApp()). No-ops if
   * already running (bootApp() can run more than once per page load —
   * fresh login vs. restoreSession() — so this must be idempotent).
   * Pings immediately, then every 60s. Skips (not clears) the tick while
   * `document.hidden` is true — the open item flagged in
   * ADMIN_SYSTEM_HEALTH.md: without this, a forgotten background tab counts
   * as "online" all day. The visibilitychange listener is attached once,
   * lazily, on first start, and pings immediately on becoming visible again
   * so "online now" doesn't wait up to 60s to catch up.
   */
  function startPresenceHeartbeat() {
    if (_heartbeatTimer) return;
    _tick();
    _heartbeatTimer = setInterval(function () {
      if (document.hidden) return;
      _tick();
    }, HEARTBEAT_INTERVAL_MS);

    if (!_visibilityHandler) {
      _visibilityHandler = function () {
        if (!document.hidden && _heartbeatTimer) _tick();
      };
      document.addEventListener('visibilitychange', _visibilityHandler);
    }
  }

  /**
   * stopPresenceHeartbeat() — call once per logout (doLogout()), same
   * pairing as WBC.refreshInterval's own clearInterval in that function.
   * The visibilitychange listener is left attached (harmless no-op while
   * _heartbeatTimer is null) rather than added/removed every cycle.
   */
  function stopPresenceHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  return {
    touchPresence,
    getUserCounts,
    getErrorLogs,
    resolveErrorLog,
    logClientError,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
  };
})();
