// ─────────────────────────────────────────────────────────────────────────────
// DSM SERVICE LAYER  (Navigation / Sidebar settings — Supabase-synced v2)
// (see EduQuest_Pending_Fixes_Report.md §1 / supabase/phase10_dsm_sync.sql)
//
// WHAT CHANGED FROM v1
//   v1 was a pure localStorage wrapper — nav customization (order,
//   visibility, labels, lock state) only ever lived in the one browser that
//   made the change. Opening EduQuest on any other device/browser showed
//   the hardcoded defaults, because that browser's localStorage never had
//   the change to begin with.
//
//   This version mirrors db-service.js's own "cache-through facade"
//   pattern (see its "THE SYNC PROBLEM" comment) for exactly the same
//   reason: dsm-manager.js's dsmLoad()/dsmSave() call DSMService.read()/
//   .write() synchronously today, with no `await`, and rewriting those
//   call sites is unnecessary — the facade makes them work unchanged:
//     • read()/write() remain perfectly synchronous. They operate on an
//       in-memory cache (`_cache`), never the network directly — that's
//       what makes them synchronous.
//     • _cache is hydrated from Supabase once at boot via initRemote()
//       (awaited in index.html's boot script, the same spot AppStore's own
//       DBService.initRemote() is awaited).
//     • write() updates _cache + the localStorage mirror IMMEDIATELY
//       (instant local persistence / offline fallback, same as before this
//       change), then queues a debounced push to Supabase.
//
//   REPOSITORY BOUNDARY: DSMService has no Supabase client of its own and
//   never calls `.from(...)` — every remote read/write goes through
//   DBService.rpc() (get_dsm_settings() / save_dsm_settings()), staying
//   inside the same "DBService is the only thing that touches the
//   Supabase client" contract every other service module in this app
//   already follows.
//
// KNOWN LIMITATION (same shape as DBService's own — see its "THE SYNC
// PROBLEM" comment): if initRemote() hasn't resolved yet the instant
// something calls read() (a very fast login before that one network
// round-trip completes), read() falls back to whatever's in localStorage
// rather than blocking on the network — same posture the main DB
// hydration already has today, not a new risk introduced here.
// ─────────────────────────────────────────────────────────────────────────────

const DSMService = (function () {
  'use strict';

  const _DSM_KEY = 'eduquest_dsm_v2';

  const _localProvider = {
    read  : function ()    { return localStorage.getItem(_DSM_KEY); },
    write : function (raw) { localStorage.setItem(_DSM_KEY, raw); },
    remove: function ()    { localStorage.removeItem(_DSM_KEY); },
    key   : _DSM_KEY,
  };

  // The in-memory cache IS the object read()/write() actually operate on —
  // same role _cache plays in db-service.js.
  // Phase 70: added a 'teacher' scope alongside 'student'/'admin' so the Nav
  // Manager can configure the teacher sidebar independently of admin's.
  let _cache = null; // { student: [...], teacher: [...], admin: [...] } | null

  function _canUseRemote() {
    return typeof DBService !== 'undefined'
      && typeof DBService.rpc === 'function'
      && typeof DBService.getAuthClient === 'function'
      && !!DBService.getAuthClient();
  }

  function _readLocalMirror() {
    try {
      const raw = _localProvider.read();
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ── Debounced upload queue — same 400ms trailing-edge shape as
  //    db-service.js's own _queueUpload()/_flushUpload(). ────────────────────
  let _uploadTimer = null;
  function _queueUpload() {
    if (_uploadTimer) clearTimeout(_uploadTimer);
    _uploadTimer = setTimeout(_flushUpload, 400);
  }

  async function _flushUpload() {
    _uploadTimer = null;
    if (!_canUseRemote() || !_cache) return;
    try {
      const { error } = await DBService.rpc('save_dsm_settings', {
        p_student: _cache.student || [],
        p_teacher: _cache.teacher || [],
        p_admin: _cache.admin || [],
      });
      if (error) {
        // Network/RLS failure (e.g. a non-staff session, which
        // save_dsm_settings() rejects server-side): local cache + the
        // localStorage mirror stay the source of truth for this browser;
        // we'll retry on the next write().
        console.warn('[DSMService] remote sync failed, staying on local cache:', error);
      }
    } catch (e) {
      console.warn('[DSMService] remote sync threw, staying on local cache:', e);
    }
  }

  return {
    /**
     * initRemote() → Promise<void>
     * Hydrates _cache from Supabase (get_dsm_settings()), falling back to
     * the localStorage mirror if the RPC fails, returns nothing saved yet,
     * or Supabase isn't configured/reachable. Call once at boot, before
     * anything calls read() — mirrors DBService.initRemote()'s own role
     * and fallback posture exactly.
     */
    initRemote: async function () {
      if (!_canUseRemote()) {
        _cache = _readLocalMirror();
        return;
      }
      try {
        const { data, error } = await DBService.rpc('get_dsm_settings', {});
        if (error) throw error;
        if (data && (Array.isArray(data.student) || Array.isArray(data.teacher) || Array.isArray(data.admin))) {
          _cache = { student: data.student || [], teacher: data.teacher || [], admin: data.admin || [] };
          try { _localProvider.write(JSON.stringify(_cache)); } catch (e) { /* best-effort mirror */ }
        } else {
          // Nothing saved server-side yet (first boot after this
          // migration ships, before any admin has hit "Apply & Refresh").
          // Fall back to whatever this browser already has locally so an
          // existing per-browser customization isn't silently wiped.
          _cache = _readLocalMirror();
        }
      } catch (e) {
        console.warn('[DSMService] initRemote() failed, falling back to local cache:', e);
        _cache = _readLocalMirror();
      }
    },

    read: function () {
      if (_cache) return JSON.parse(JSON.stringify(_cache));
      const local = _readLocalMirror();
      if (local) { _cache = local; return JSON.parse(JSON.stringify(_cache)); }
      return null;
    },

    write: function (data) {
      _cache = data;
      try { _localProvider.write(JSON.stringify(data)); } catch (e) {
        console.warn('[DSMService] localStorage mirror write failed (quota?):', e);
      }
      if (_canUseRemote()) _queueUpload();
    },

    remove: function () {
      _cache = null;
      try { _localProvider.remove(); } catch (e) {}
    },

    get storageKey() { return _localProvider.key; },
  };
})();
