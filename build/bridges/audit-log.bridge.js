// Phase 7, Stream B — bridge for modules/admin/audit-log.js.
import {
  renderAuditLog, auditLogSetTeacherFilter, auditLogSetActionFilter,
  auditLogSetTableFilter, auditLogLoadMore,
} from '../../src/modules/admin/audit-log.js';

window.renderAuditLog = renderAuditLog;
window.auditLogSetTeacherFilter = auditLogSetTeacherFilter;
window.auditLogSetActionFilter = auditLogSetActionFilter;
window.auditLogSetTableFilter = auditLogSetTableFilter;
window.auditLogLoadMore = auditLogLoadMore;
