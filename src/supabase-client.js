// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT — connection layer (src/supabase-client.js)
//
// Phase 6 (Decompose God Files) extraction from db-service.js. Owns exactly
// two things: constructing the lazy Supabase client singleton, and deciding
// whether this session is running against Supabase or the localStorage
// fallback.
//
// REQUIRES: window.supabase (loaded via CDN script tag) and
// window.__EDUQUEST_SUPABASE_URL__ / window.__EDUQUEST_SUPABASE_ANON_KEY__
// (set inline in index.html) — both BEFORE this runs. If the CDN script or
// config is absent (offline dev, or the CDN is blocked), getClient() returns
// null and every caller falls back to the v1 localStorage provider, exactly
// as before.
//
// Phase 7 (2026-08-10, session 13) — step 5.3, sixth real conversion. This
// is the real-ESM twin of the original ../supabase-client.js, which stays
// completely untouched. Consumed elsewhere (db-service.js) as a namespace
// object — `SupabaseClient.getClient()` — not as individual function
// imports, so the export shape here matches that exactly: one named export,
// same object shape as the original's `window.SupabaseClient`.
// ─────────────────────────────────────────────────────────────────────────────

export const SupabaseClient = (function () {
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
