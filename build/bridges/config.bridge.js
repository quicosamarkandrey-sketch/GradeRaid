// Phase 7 (2026-08-10, session 15) — bridge for the eleventh real conversion.
// Sets the SAME window global names supabase-client.js (classic and its
// own src/ twin) already read, not a new naming convention.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../src/config.js';

window.__EDUQUEST_SUPABASE_URL__ = SUPABASE_URL;
window.__EDUQUEST_SUPABASE_ANON_KEY__ = SUPABASE_ANON_KEY;
