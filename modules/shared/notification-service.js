// ═══════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/notification-service.js
//  PHASE 67 — STUDENT NOTIFICATION SYSTEM
//
//  STUDENT-ONLY, on purpose (see the topbar wiring in index.html/topbar.js —
//  the bell is hidden entirely for currentRole 'admin'/'teacher'). Nothing
//  here is registered or rendered for staff sessions.
//
//  DESIGN — why notifications are SYNTHESIZED, not written at the source:
//    The events a student cares about (quiz/campaign/boss/achievement/mail
//    rewards, admin point grants, store purchases) are already written to
//    DB.pointLog and DB.orders by six-plus different call sites across the
//    codebase (recitation/logger.js, campaign_engine.js, combat-settings.js,
//    ach_engine.js, mail-engine.js, student-manager.js, index.html's
//    finishQuiz(), shop_store.js's cartCheckout()) — several of which run
//    from a TEACHER's session, not the student's own. Teaching every one of
//    those call sites to also insert into `notifications` would mean half
//    of them need permission to write a *different student's* row, which
//    reopens exactly the kind of RLS carve-out (is_staff_for_section, etc.)
//    that's caused most of the 42501 bugs in this project's history.
//
//    Instead, this service reads point_log/orders — which the affected
//    student's own client already pulls and can already see under existing
//    RLS — and turns any row it hasn't notified about yet into a
//    `notifications` row, written by that student's own session. Simple
//    "student_id = auth.uid()" RLS the whole way (see
//    supabase/phase67_notifications.sql), no exceptions needed.
//
//    Practical effect: a notification appears the moment the affected
//    student's client is running and pulls fresh data — instantly if they're
//    online when it happens (the existing postgres_changes subscription on
//    point_log/orders triggers a pull, which triggers this), or the next
//    time they log in otherwise.
//
//  BOOTSTRAP — first time this ships for a given student, DB.notifications
//    is empty and DB.pointLog might have months of history already in it.
//    Backfilling all of it as unread would flood the bell for a feature that
//    was never there before. So: the very first synthesize() call for a
//    student (tracked via a local "bootstrapped" flag, see NOTIF_BOOT_KEY)
//    imports a capped, already-READ backfill (history is there if they open
//    the bell, nothing pings them for it) and every call after that treats
//    genuinely new rows normally (unread, toast-worthy).
//
//  Exports: window.eqTimeAgo(iso), window.NotificationService
//  DEPENDENCIES: DB/loadDB/saveDB/currentUser/currentRole (globals), uid()
//    (utils.js), toast() (dom.js), navTo() (nav.js). Must load AFTER
//    db-schema.js (DB.notifications default) and BEFORE topbar.js calls
//    NotificationService.refresh() from updateTopbar().
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared relative-time formatter ──────────────────────────────────────────
// Used by the notification panel AND the dashboard's Overall Activity feed
// (index.html renderStudentDashboard()) so neither one ever freezes on a
// stored string the way DB.pointLog[].when used to (see FIXES doc for
// Phase 67 — the old bug was literally storing the word "Just now" forever).
// Always compute from a real ISO timestamp at render time instead.
window.eqTimeAgo = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 0 || diffMs < 60000) return 'Just now';
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm ago';
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h ago';
  // Calendar-day comparison (not a raw 24h/48h bucket) so "Yesterday" means
  // yesterday even if it was only 3 hours ago by clock time.
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((nowStart - dayStart) / 86400000);
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff > 1 && dayDiff < 7) return dayDiff + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

(function () {
  const NOTIF_BOOT_KEY_PREFIX = 'eq_notif_bootstrapped_';
  const BOOT_POINTLOG_CAP = 30; // capped one-time backfill, see header comment
  const BOOT_ORDERS_CAP   = 10;
  const LOCAL_NOTIF_CAP   = 200; // trims local array growth; server keeps full history

  let _panelOpen = false;

  // ── Classification: DB.pointLog[].what (free text) → notification content ─
  // pointLog entries are written by 7 different call sites with their own
  // free-text `what` strings (see header comment). This is a best-effort
  // keyword/regex match, not a structured field — if a future call site's
  // wording doesn't match any pattern here it just falls through to the
  // generic "Points Awarded/Deducted" bucket, which is always a safe default.
  //
  // IMPORTANT — title/body here are deliberately NOT the same text the
  // dashboard's Overall Activity feed shows. Overall Activity is a terse,
  // ledger-style history (it displays entry.what verbatim, e.g. "Quest:
  // Algebra Basics (86%)"); a notification is a one-off alert, so it gets a
  // friendlier, reworded sentence built from the same underlying data
  // ("Quest Completed! You scored 86% on 'Algebra Basics' and earned 15
  // XP."). Only the icon is intentionally shared between the two — that's
  // just consistent iconography, not duplicated wording.
  function _classifyPointLog(entry) {
    const what = entry.what || '';
    const pts  = typeof entry.pts === 'number' ? entry.pts : 0;
    let m;

    if ((m = /^Quest:\s*(.+?)\s*\((\d+)%\)\s*$/.exec(what))) {
      return {
        type: 'quiz', icon: '⚔️', action: 's-quizzes',
        title: 'Quest Completed!',
        body: `You scored ${m[2]}% on "${m[1]}"${pts ? ` and earned ${pts} XP` : ''}.`,
      };
    }
    if ((m = /^Stage:\s*(.+)$/.exec(what))) {
      return {
        type: 'campaign', icon: '🗺️', action: 's-quizzes',
        title: 'Campaign Stage Cleared!',
        body: `You cleared "${m[1]}"${pts ? ` and earned ${pts} XP` : ''}.`,
      };
    }
    if ((m = /Boss Raid:\s*"([^"]+)"/.exec(what))) {
      return {
        type: 'boss', icon: '👹', action: 's-world-boss',
        title: 'Boss Defeated!',
        body: `Your party brought down ${m[1]}. Victory rewards are waiting in your inventory.`,
      };
    }
    if ((m = /Achievement Claimed:\s*(.+)$/.exec(what))) {
      return {
        type: 'achievement', icon: '🏅', action: 's-badges',
        title: 'Achievement Unlocked!',
        body: `You claimed the reward for "${m[1]}".`,
      };
    }
    if ((m = /Mail Reward:\s*(.+)$/.exec(what))) {
      return {
        type: 'mail_reward', icon: '📬', action: 's-mail',
        title: 'Mail Reward Claimed!',
        body: `You picked up a reward attached to "${m[1]}".`,
      };
    }
    if (/^Recitation/.test(what)) {
      return {
        type: 'points', icon: '🎤', action: 's-dashboard',
        title: pts >= 0 ? 'Recitation Points' : 'Recitation Deduction',
        body: pts >= 0
          ? `Your teacher awarded you ${pts} points for reciting in class.`
          : `${Math.abs(pts)} points were deducted for recitation.`,
      };
    }
    if (/^Attendance/.test(what)) {
      return {
        type: 'points', icon: '📅', action: 's-dashboard',
        title: 'Attendance Logged',
        body: `Your attendance was just recorded${pts ? ` (+${pts} pts)` : ''}.`,
      };
    }
    if (pts < 0) {
      return {
        type: 'points', icon: '⚠️', action: 's-dashboard',
        title: 'Points Deducted',
        body: `Your teacher deducted ${Math.abs(pts)} points. Tap to see your recent activity.`,
      };
    }
    return {
      type: 'points', icon: '⭐', action: 's-dashboard',
      title: 'Points Awarded',
      body: `Your teacher awarded you ${pts} points. Tap to see your recent activity.`,
    };
  }

  // Exposed globally — index.html's renderStudentDashboard() Overall Activity
  // feed reuses this for its icon ONLY (c.icon), never c.title/c.body, so the
  // two surfaces stay visually consistent without repeating the same wording.
  window.eqClassifyActivity = _classifyPointLog;

  // [Phase 3 migration] reads go through AppStore.getSlice() instead of the
  // live `DB` global — see modules/core/state-manager.js. getSlice() clones
  // only the requested sub-tree, so what these functions get back is always
  // a snapshot, never a reference into AppStore's internal _state. That's
  // deliberate: it's what forces every write in this file to go back through
  // AppStore.updateState() instead of mutating a found object in place (the
  // old DB.notifications.find() pattern used to work only because DB was a
  // live shared reference — see markRead/markAllRead/openRow below for
  // where that mattered).
  function _existingSourceIds(sid, notifications) {
    const set = new Set();
    (notifications || []).forEach(n => { if (n.studentId === sid && n.sourceId) set.add(n.sourceId); });
    return set;
  }

  // ── Core synthesis pass ───────────────────────────────────────────────────
  // Returns the array of genuinely-new (non-bootstrap) notifications created
  // this call, so refresh() knows whether a toast is warranted.
  function synthesize() {
    if (currentRole !== 'student' || !currentUser || typeof AppStore === 'undefined') return [];
    const sid = currentUser.id;

    let isBootstrap = false;
    const bootKey = NOTIF_BOOT_KEY_PREFIX + sid;
    try { isBootstrap = !localStorage.getItem(bootKey); } catch (e) { /* storage unavailable — treat as non-bootstrap, safest default */ }

    const notifications = AppStore.getSlice(s => s.notifications) || [];
    const existing = _existingSourceIds(sid, notifications);
    const created = [];

    let plRows = (AppStore.getSlice(s => s.pointLog) || []).filter(p => p.studentId === sid && p.id && !existing.has(p.id));
    if (isBootstrap) plRows = plRows.slice(0, BOOT_POINTLOG_CAP);
    plRows.forEach(p => {
      const c = _classifyPointLog(p);
      created.push({
        id: 'ntf_' + uid(), studentId: sid, type: c.type, icon: c.icon, title: c.title,
        body: c.body, action: c.action, pts: typeof p.pts === 'number' ? p.pts : null,
        sourceId: p.id, read: isBootstrap,
        createdAt: p.createdAt || new Date().toISOString(),
      });
    });

    let ordRows = (AppStore.getSlice(s => s.orders) || []).filter(o => o.studentId === sid && o.orderId && !existing.has(o.orderId));
    if (isBootstrap) ordRows = ordRows.slice(0, BOOT_ORDERS_CAP);
    ordRows.forEach(o => {
      created.push({
        id: 'ntf_' + uid(), studentId: sid, type: 'store', icon: o.emoji || '🛍️',
        // Distinct from the dashboard's "Purchased {itemName}" ledger line —
        // this is the alert version, phrased as a receipt/confirmation.
        title: 'Purchase Confirmed',
        body: `Your order for "${o.itemName}" (${o.cost || 0} pts) was placed. Visit the Armory to claim it.`,
        action: 's-inventory',
        pts: -(o.cost || 0), sourceId: o.orderId, read: isBootstrap,
        createdAt: o.createdAt || new Date().toISOString(),
      });
    });

    if (created.length) {
      AppStore.updateState(draft => {
        if (!Array.isArray(draft.notifications)) draft.notifications = [];
        draft.notifications = created.concat(draft.notifications)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, LOCAL_NOTIF_CAP);
      }, { type: 'notifications:synthesized', payload: { studentId: sid, count: created.length } });
    }
    if (isBootstrap) {
      try { localStorage.setItem(bootKey, '1'); } catch (e) { /* non-fatal — worst case, re-backfills (still capped) next load */ }
      return []; // bootstrap backfill never toasts
    }
    return created;
  }

  function _myNotifs() {
    if (currentRole !== 'student' || !currentUser) return [];
    return (AppStore.getSlice(s => s.notifications) || [])
      .filter(n => n.studentId === currentUser.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function _unreadCount() {
    return _myNotifs().filter(n => !n.read).length;
  }

  // ── Badge ──────────────────────────────────────────────────────────────────
  function _renderBadge() {
    const wrap  = document.getElementById('notif-wrap');
    const badge = document.getElementById('notif-badge');
    if (!wrap || !badge) return;
    if (currentRole !== 'student') { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const n = _unreadCount();
    if (n > 0) {
      badge.style.display = 'block';
      badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Dropdown panel ─────────────────────────────────────────────────────────
  function _rowHtml(n) {
    const pts = n.pts;
    const ptsHtml = (typeof pts === 'number' && pts !== 0)
      ? `<div class="notif-row-pts" style="color:${pts > 0 ? '#4edea3' : '#ffb4ab'}">${pts > 0 ? '+' : ''}${pts}</div>`
      : '';
    return `
    <div class="notif-row ${n.read ? '' : 'unread'}" onclick="NotificationService.openRow('${n.id}')">
      <div class="notif-row-icon">${n.icon || '🔔'}</div>
      <div class="notif-row-body">
        <div class="notif-row-title">${n.title}</div>
        <div class="notif-row-sub">${(n.body || '').replace(/</g, '&lt;')}</div>
        <div class="notif-row-when">${window.eqTimeAgo(n.createdAt)}</div>
      </div>
      ${ptsHtml}
      ${n.read ? '' : '<div class="notif-row-dot"></div>'}
    </div>`;
  }

  function _renderPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const notifs = _myNotifs().slice(0, 40);
    const unread = notifs.filter(n => !n.read).length;
    panel.innerHTML = `
      <div class="notif-panel-head">
        <h3>Notifications</h3>
        ${unread > 0 ? `<button class="notif-mark-all" onclick="NotificationService.markAllRead()">Mark all read</button>` : ''}
      </div>
      ${notifs.length
        ? notifs.map(_rowHtml).join('')
        : `<div class="notif-empty"><span class="emoji">🔔</span>No notifications yet.<br>Quests, rewards, and purchases will show up here.</div>`}
    `;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window.NotificationService = {
    // Called from updateTopbar() (topbar.js) after every state refresh — the
    // one central hook already fired app-wide whenever DB changes.
    refresh: function () {
      const fresh = synthesize();
      _renderBadge();
      if (_panelOpen) _renderPanel();
      if (fresh.length === 1) {
        toast(`${fresh[0].icon || '🔔'} ${fresh[0].title}`, '#d0bcff');
      } else if (fresh.length > 1) {
        toast(`🔔 You have ${fresh.length} new updates`, '#d0bcff');
      }
    },

    toggle: function () {
      const panel = document.getElementById('notif-panel');
      if (!panel) return;
      _panelOpen = !_panelOpen;
      if (_panelOpen) {
        _renderPanel();
        panel.style.display = 'block';
      } else {
        panel.style.display = 'none';
      }
    },

    close: function () {
      const panel = document.getElementById('notif-panel');
      if (!panel) return;
      _panelOpen = false;
      panel.style.display = 'none';
    },

    markRead: function (id) {
      // Look up first (read-only, cloned) so we only pay for an updateState
      // call — and its persist + subscriber notify — when something is
      // actually changing, same as the old "if (n && !n.read)" gate.
      const existing = (AppStore.getSlice(s => s.notifications) || []).find(x => x.id === id);
      if (existing && !existing.read) {
        AppStore.updateState(draft => {
          const n = (draft.notifications || []).find(x => x.id === id);
          if (n) n.read = true;
        }, { type: 'notifications:read', payload: { id } });
      }
      _renderBadge();
      if (_panelOpen) _renderPanel();
    },

    markAllRead: function () {
      const sid = currentUser && currentUser.id;
      const hasUnread = _myNotifs().some(n => !n.read);
      if (hasUnread) {
        AppStore.updateState(draft => {
          (draft.notifications || [])
            .filter(n => n.studentId === sid)
            .forEach(n => { n.read = true; });
        }, { type: 'notifications:all-read', payload: { studentId: sid } });
      }
      _renderBadge();
      if (_panelOpen) _renderPanel();
    },

    // Click on a row: mark read, close the panel, and navigate to wherever
    // that notification is about (Quest Board, Armory Inventory, etc).
    openRow: function (id) {
      const n = (AppStore.getSlice(s => s.notifications) || []).find(x => x.id === id);
      if (!n) return;
      if (!n.read) {
        AppStore.updateState(draft => {
          const target = (draft.notifications || []).find(x => x.id === id);
          if (target) target.read = true;
        }, { type: 'notifications:read', payload: { id } });
      }
      this.close();
      _renderBadge();
      // n.action came from the pre-update snapshot, but action is never
      // mutated by the read-flag update above, so it's still accurate.
      if (n.action && typeof navTo === 'function') navTo(n.action);
    },
  };

  // Close the dropdown on an outside click (capture phase so it still
  // closes even if the click target itself gets removed/re-rendered).
  document.addEventListener('click', function (e) {
    if (!_panelOpen) return;
    const panel = document.getElementById('notif-panel');
    const wrap  = document.getElementById('notif-wrap');
    if (!panel || !wrap) return;
    if (wrap.contains(e.target)) return; // bell button itself toggles separately
    if (!panel.contains(e.target)) NotificationService.close();
  }, true);
})();

console.log('[EduQuest] shared/notification-service.js loaded — NotificationService registered.');
