// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT — connection layer
//
// Phase 6 (Decompose God Files) extraction from db-service.js. Owns exactly
// two things: constructing the lazy Supabase client singleton, and deciding
// whether this session is running against Supabase or the localStorage
// fallback. This used to be db-service.js's _getClient()/_resolveProvider()
// — moved out verbatim, no behavior change. db-service.js's own
// _getClient()/_resolveProvider() are now one-line delegates to this file,
// so every one of its existing internal call sites (and the public API
// methods built on them — rpc(), uploadPublicFile(), getAuthClient(),
// sendPasswordResetEmail()) are unchanged.
//
// REQUIRES: window.supabase (loaded via CDN script tag) and
// window.__EDUQUEST_SUPABASE_URL__ / window.__EDUQUEST_SUPABASE_ANON_KEY__
// (set inline in index.html) — both BEFORE this file. This file itself must
// load BEFORE db-service.js. If the CDN script or config is absent (offline
// dev, or the CDN is blocked), getClient() returns null and every caller
// falls back to the v1 localStorage provider, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

const SupabaseClient = (function () {
  'use strict';

  // ── Config — fill in from your Supabase project settings ─────────────────
  const _SUPABASE_URL      = window.__EDUQUEST_SUPABASE_URL__      || '';
  const _SUPABASE_ANON_KEY = window.__EDUQUEST_SUPABASE_ANON_KEY__ || '';

  // ── Supabase client (lazy singleton) ──────────────────────────────────────
  let _sb = null;
  function getClient() {
    if (_sb) return _sb;
    if (typeof window.supabase === 'undefined' || !_SUPABASE_URL || !_SUPABASE_ANON_KEY) {
      return null;
    }
    _sb = window.supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _sb;
  }

  function resolveProvider() {
    return getClient() ? 'supabase' : 'localStorage';
  }

  return {
    getClient: getClient,
    resolveProvider: resolveProvider,
  };
})();

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.SupabaseClient = SupabaseClient;
