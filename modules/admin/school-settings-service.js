// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/school-settings-service.js
//  Service layer for global school settings (Chunk E "Governance").
//  (ISOLATION_ROLES_PLAN.md Chunk E, "global settings beyond nav config" —
//   see supabase/phase40_governance_audit_and_settings.sql.)
//
//  SCOPE NOTE (confirmed before building): v1 is just school_name (text) and
//  school_year_label (single free-text label, e.g. "SY 2026-2027") — no
//  logo/branding, no start/end dates, no multi-term calendar. Extend the SQL
//  singleton row + these two functions together if that scope grows later;
//  don't bolt extra fields onto get()/save() without a matching column.
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  no render layer calls DBService.rpc() directly for this. It calls
//  SchoolSettingsService.<method>(...).
//
//  get() is intentionally callable by anyone signed in (or anon) — a school
//  name/year label isn't sensitive and may end up shown in headers or the
//  kiosk display later. save() is admin-only server-side (is_admin() check
//  inside save_school_settings()); a teacher calling it gets an RPC error.
// ═══════════════════════════════════════════════════════════════════════════════

window.SchoolSettingsService = (function () {
  'use strict';

  /**
   * get() → Promise<{ok, settings?, error?}>
   * settings shape: { schoolName, schoolYearLabel, updatedAt, updatedBy }
   */
  async function get() {
    const { data, error } = await DBService.rpc('get_school_settings', {});
    if (error) return { ok: false, error: error.message || 'Could not load school settings.' };
    const row = data || {};
    return {
      ok: true,
      settings: {
        schoolName: row.school_name || '',
        schoolYearLabel: row.school_year_label || '',
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      },
    };
  }

  /**
   * save({ schoolName, schoolYearLabel }) → Promise<{ok, settings?, error?}>
   */
  async function save({ schoolName, schoolYearLabel }) {
    const { data, error } = await DBService.rpc('save_school_settings', {
      p_school_name: schoolName || null,
      p_school_year_label: schoolYearLabel || null,
    });
    if (error) return { ok: false, error: error.message || 'Could not save school settings.' };
    const row = data || {};
    return {
      ok: true,
      settings: {
        schoolName: row.school_name || '',
        schoolYearLabel: row.school_year_label || '',
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      },
    };
  }

  return { get, save };
})();
