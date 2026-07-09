// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/audit-log-service.js
//  Service layer for the admin audit log.
//  (ISOLATION_ROLES_PLAN.md Chunk E "Governance" — built ahead of Chunk C per
//   the agreed build order A → B → E → C → D → F, so "Edit as" has somewhere
//   to log to on day one. See supabase/phase40_governance_audit_and_settings.sql.)
//
//  SCOPE NOTE (confirmed before building): this is deliberately NARROW —
//  wired for the "Edit as" override only, not a generic action-logger for
//  every admin write. Chunk D's ownership transfer and Chunk F's
//  registration reassignment get their own logging later if wanted; don't
//  extend this file's surface to cover them without that being decided.
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  no render layer calls DBService.rpc() directly for audit data. It calls
//  AuditLogService.<method>(...).
//
//  WHAT'S HERE
//    logEditAsAction() — called once per write Chunk C performs while an
//    admin is in "Edit as" mode for a teacher. No render layer calls this
//    yet — Chunk C is what will. It's here now so C doesn't also need a
//    SQL change when it ships.
//    getLog() — admin-only read, optionally filtered to one teacher. No
//    screen consumes this yet either (there's nothing to show until C
//    produces entries) — provided now so a future "Audit Log" viewer screen
//    is a render-layer-only addition.
// ═══════════════════════════════════════════════════════════════════════════════

window.AuditLogService = (function () {
  'use strict';

  /**
   * logEditAsAction({ targetTeacherId, tableName, recordId, action, details?, sessionId? })
   *   → Promise<{ok, row?, error?}>
   * action must be 'create' | 'update' | 'delete'. actor is resolved
   * server-side from the caller's own session — never pass one in.
   */
  async function logEditAsAction({ targetTeacherId, tableName, recordId, action, details = null, sessionId = null }) {
    const { data, error } = await DBService.rpc('log_edit_as_action', {
      p_target_teacher_id: targetTeacherId,
      p_table_name: tableName,
      p_record_id: recordId,
      p_action: action,
      p_details: details,
      p_session_id: sessionId,
    });
    if (error) return { ok: false, error: error.message || 'Could not log this action.' };
    return { ok: true, row: data };
  }

  /**
   * getLog({ targetTeacherId?, limit? }) → Promise<{ok, rows?, error?}>
   * Admin-only server-side; a non-admin caller gets back an RPC error.
   */
  async function getLog({ targetTeacherId = null, limit = 200 } = {}) {
    const { data, error } = await DBService.rpc('get_audit_log', {
      p_target_teacher_id: targetTeacherId,
      p_limit: limit,
    });
    if (error) return { ok: false, error: error.message || 'Could not load the audit log.' };
    return { ok: true, rows: data || [] };
  }

  return { logEditAsAction, getLog };
})();
