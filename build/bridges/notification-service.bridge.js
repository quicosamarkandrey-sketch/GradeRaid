// Phase 7 (Stream A) — bridge for modules/shared/notification-service.js.
import { eqTimeAgo, eqClassifyActivity, NotificationService } from '../../src/modules/shared/notification-service.js';

window.eqTimeAgo = eqTimeAgo;
window.eqClassifyActivity = eqClassifyActivity;
window.NotificationService = NotificationService;
