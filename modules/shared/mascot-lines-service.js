// ══════════════════════════════════════════════════════
//  modules/shared/mascot-lines-service.js
//  Service layer for admin-editable Mascot/Narrator line pools
//  (Improvement Plan §6, §12 item 7 — see supabase/phase62_mascot_line_settings.sql).
//
//  Lives in modules/shared/, not modules/admin/, because get() is called by
//  BOTH the admin editor (modules/admin/mascot-lines.js) AND the student
//  quiz runner (index.html's startQuiz(), to populate
//  window._eqMascotCustomLines before eqMascotLine() ever needs it).
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  no render layer calls DBService.rpc() directly for this. It calls
//  MascotLinesService.<method>(...).
//
//  Exports: window.MascotLinesService = { get, save }
// ══════════════════════════════════════════════════════

window.MascotLinesService = (function () {
  'use strict';

  /**
   * get() → Promise<{ok, customLines?, updatedAt?, updatedBy?, error?}>
   * customLines shape: see the header comment in phase62's SQL file.
   * Never throws — a failed/blocked read resolves {ok:false} so callers
   * (especially the quiz screen) can fall back to defaults-only instead of
   * blocking quiz start on a settings fetch.
   */
  async function get() {
    try {
      const { data, error } = await DBService.rpc('get_mascot_line_settings', {});
      if (error) return { ok: false, error: error.message || 'Could not load mascot lines.' };
      const row = data || {};
      return {
        ok: true,
        customLines: row.custom_lines || {},
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Could not load mascot lines.' };
    }
  }

  /**
   * save(customLines) → Promise<{ok, customLines?, error?}>
   * Replaces the WHOLE blob — admin-only server-side (is_admin() check
   * inside save_mascot_line_settings()).
   */
  async function save(customLines) {
    try {
      const { data, error } = await DBService.rpc('save_mascot_line_settings', {
        p_custom_lines: customLines || {},
      });
      if (error) return { ok: false, error: error.message || 'Could not save mascot lines.' };
      const row = data || {};
      return {
        ok: true,
        customLines: row.custom_lines || {},
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Could not save mascot lines.' };
    }
  }

  return { get, save };
})();
