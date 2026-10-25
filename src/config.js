// ─────────────────────────────────────────────────────────────────────────────
// src/config.js — Supabase project config.
//
// Real ESM twin of index.html's first inline <script> block (2 lines: the
// Supabase project URL and anon/publishable key). The original block stays
// completely untouched in index.html. Unlike every other conversion so
// far, there's no function here to bridge — just two config values — so
// the bridge (build/bridges/config.bridge.js) sets the SAME
// window.__EDUQUEST_SUPABASE_URL__ / window.__EDUQUEST_SUPABASE_ANON_KEY__
// globals that supabase-client.js (both the classic original and its own
// src/ twin from session 13) reads directly, keeping the naming exactly
// as-is rather than introducing a second config convention.
//
// The anon/publishable key is safe to keep in client-side source — that's
// what Supabase's "publishable" key is designed for (RLS policies are the
// real access boundary, not key secrecy). Not treated as a secret here,
// consistent with how the original inline block always exposed it as a
// plain `window.X = '...'` visible to anyone viewing page source.
//
// Phase 7 (2026-08-10, session 15) — step 5.3, eleventh real conversion.
// ─────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://ptxzsllndtacrnpaoxvq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Zpty0lLj66Ri4sWqin2QMw_ksF_vBT8';
