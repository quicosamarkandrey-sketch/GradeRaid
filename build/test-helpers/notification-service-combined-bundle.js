(() => {
  // src/modules/core/state-manager.js
  var AppStore = (function() {
    "use strict";
    let _state = null;
    let _subscribers = {};
    let _persistTimer = null;
    let _persistDirty = false;
    let _readyResolve = null;
    const _DELTA_TRACKED_SLICES = {
      point_log: { statePath: "pointLog", idField: "id" },
      notifications: { statePath: "notifications", idField: "id" },
      orders: { statePath: "orders", idField: "orderId" },
      // boss_participants: keyed bossParticipants[bossIdx][studentId], not an
      // array — see 'nested' shape above. Composite dirty id is
      // "<bossIdx>:<studentId>". This is the first delta-tracked table where
      // the row a session dirties is genuinely reachable by ANOTHER student's
      // combat session concurrently (each student answering boss questions
      // only ever touches their OWN studentId key), unlike point_log/
      // notifications/orders where every no-clobber test so far modeled "two
      // different rows," never true concurrent access to one.
      boss_participants: { statePath: "bossParticipants", shape: "nested" },
      // inventory: keyed inventory[studentId] = [items...] — see
      // 'nestedArray' shape above. Composite dirty id is
      // "<studentId>:<itemId>". The genuinely-different-actor case here is a
      // teacher running the shop POS terminal (shop_pos_terminal.js writes
      // into draft.inventory[studentId] on the STUDENT's behalf) at the same
      // time that student's own device independently purchases something —
      // two different sessions appending to the same student's item list.
      inventory: { statePath: "inventory", shape: "nestedArray", innerIdField: "itemId" },
      // redemptions: flat array, append-only history log (client-generated
      // orderId per redemption, never edited after creation) — same
      // low-blast-radius shape as point_log, the very first table converted.
      // Sixth table, no new mechanism needed.
      redemptions: { statePath: "redemptions", idField: "orderId" },
      // titles: flat array, teacher-owned catalog rows (title editor). Same
      // "whole-row-replacement is fine, just needs to be scoped to the row
      // this session actually edited" reasoning as every array-shaped table
      // so far — the risk here isn't a second human so much as the same
      // teacher's own second open tab autosaving stale data over an edit
      // made in the first.
      titles: { statePath: "titles", idField: "id" },
      // quiz_history: keyed quizHistory[studentId] = [attempts...] — same
      // 'nestedArray' shape as inventory. Eighth table, and — like
      // point_log/redemptions — append-only (an attempt's fields are fixed
      // forever once logged; see finishQuiz()/abortQuiz() in index.html,
      // neither ever edits an existing entry). Client-generates its own id
      // ('qh_' + uid()) at creation time, same as every table converted so
      // far — this is the property boss_events lacks (its id is assigned by
      // Postgres, not the client, so a brand-new row has nothing to track
      // dirty by until AFTER its first successful sync — ruled it out as a
      // delta-sync candidate for that reason, not attempted this session).
      quiz_history: { statePath: "quizHistory", shape: "nestedArray", innerIdField: "id" },
      // quizzes: flat array, teacher-owned catalog rows — same pattern as
      // titles. Ninth table, client-generated id verified at
      // openQuizBuilder()'s draft-creation time before converting.
      quizzes: { statePath: "quizzes", idField: "id" },
      // campaign_worlds: flat array, client-generated id. Tenth table — see
      // db-service.js's config comment for why THIS one needed an actual code
      // fix (not just a config addition): sort_order used to be computed from
      // array position within whatever subset buildRows received, which
      // delta-filtering would have silently corrupted.
      campaign_worlds: { statePath: "stageMap", idField: "id" },
      // profiles: flat array (DB.students), but scoped with `watchFields` —
      // see _projectWatchFields()'s own comment for why: a student row's
      // xp/coins/level/tier/etc change constantly via gameplay and are
      // RPC-owned, never part of this table's own upsert payload, so
      // diffing the whole row would dirty this table almost every save.
      // Eleventh table converted, and the one that needed the
      // upsertRows-return-value contract (db-service.js's _runTableSync)
      // before it could be delta-tracked safely at all — see that table's
      // own config comment.
      profiles: {
        statePath: "students",
        idField: "id",
        watchFields: ["name", "init", "color", "firstName", "lastName", "profilePic", "classId"]
      },
      // shop_products / achievements: flat array, teacher-owned catalog rows
      // — same pattern as titles/quizzes. Twelfth and thirteenth tables,
      // client-generated ids verified at creation before converting. Every
      // field either table's buildRows sends is a catalog-definition column
      // (no per-student unlock/stock state, which stays RPC-only) — no
      // watchFields scoping needed, unlike profiles.
      shop_products: { statePath: "store", idField: "id" },
      achievements: { statePath: "achievements", idField: "id" }
    };
    let _dirty = {};
    function _trackDirty(oldState, newState) {
      Object.keys(_DELTA_TRACKED_SLICES).forEach(function(table) {
        const cfg = _DELTA_TRACKED_SLICES[table];
        if (cfg.shape === "nested") {
          _trackDirtyNested(table, cfg, oldState, newState);
          return;
        }
        if (cfg.shape === "nestedArray") {
          _trackDirtyNestedArray(table, cfg, oldState, newState);
          return;
        }
        const oldArr = oldState && Array.isArray(oldState[cfg.statePath]) ? oldState[cfg.statePath] : [];
        const newArr = newState && Array.isArray(newState[cfg.statePath]) ? newState[cfg.statePath] : [];
        if (!newArr.length) return;
        const oldById = {};
        oldArr.forEach(function(row) {
          const id = row && row[cfg.idField];
          if (id !== void 0 && id !== null) oldById[id] = JSON.stringify(_projectWatchFields(row, cfg.watchFields));
        });
        newArr.forEach(function(row) {
          const id = row && row[cfg.idField];
          if (id === void 0 || id === null) return;
          const prevJSON = oldById[id];
          const newJSON = JSON.stringify(_projectWatchFields(row, cfg.watchFields));
          if (prevJSON === void 0 || prevJSON !== newJSON) {
            if (!_dirty[table]) _dirty[table] = /* @__PURE__ */ new Set();
            _dirty[table].add(id);
          }
        });
      });
    }
    function _projectWatchFields(row, fields) {
      if (!fields) return row;
      const out = {};
      fields.forEach(function(f) {
        out[f] = row[f];
      });
      return out;
    }
    function _trackDirtyNested(table, cfg, oldState, newState) {
      const oldRoot = oldState && oldState[cfg.statePath] || {};
      const newRoot = newState && newState[cfg.statePath] || {};
      Object.keys(newRoot).forEach(function(outerKey) {
        const oldInner = oldRoot[outerKey] || {};
        const newInner = newRoot[outerKey] || {};
        Object.keys(newInner).forEach(function(innerKey) {
          const id = outerKey + ":" + innerKey;
          const hadBefore = Object.prototype.hasOwnProperty.call(oldInner, innerKey);
          const newJSON = JSON.stringify(newInner[innerKey]);
          if (!hadBefore || JSON.stringify(oldInner[innerKey]) !== newJSON) {
            if (!_dirty[table]) _dirty[table] = /* @__PURE__ */ new Set();
            _dirty[table].add(id);
          }
        });
      });
    }
    function _trackDirtyNestedArray(table, cfg, oldState, newState) {
      const oldRoot = oldState && oldState[cfg.statePath] || {};
      const newRoot = newState && newState[cfg.statePath] || {};
      Object.keys(newRoot).forEach(function(outerKey) {
        const oldArr = Array.isArray(oldRoot[outerKey]) ? oldRoot[outerKey] : [];
        const newArr = Array.isArray(newRoot[outerKey]) ? newRoot[outerKey] : [];
        if (!newArr.length) return;
        const oldById = {};
        oldArr.forEach(function(row) {
          const innerId = row && row[cfg.innerIdField];
          if (innerId !== void 0 && innerId !== null) oldById[innerId] = JSON.stringify(row);
        });
        newArr.forEach(function(row) {
          const innerId = row && row[cfg.innerIdField];
          if (innerId === void 0 || innerId === null) return;
          const id = outerKey + ":" + innerId;
          const prevJSON = oldById[innerId];
          if (prevJSON === void 0 || prevJSON !== JSON.stringify(row)) {
            if (!_dirty[table]) _dirty[table] = /* @__PURE__ */ new Set();
            _dirty[table].add(id);
          }
        });
      });
    }
    function _persistDirtySnapshot() {
      if (typeof DBService.writeDirty !== "function") return;
      const snapshot = {};
      Object.keys(_dirty).forEach(function(table) {
        snapshot[table] = Array.from(_dirty[table]);
      });
      try {
        DBService.writeDirty(snapshot);
      } catch (e) {
        console.warn("[AppStore] failed to persist dirty-tracking snapshot:", e);
      }
    }
    function _dirtyIdStillExists(cfg, id) {
      const root = _state && _state[cfg.statePath];
      if (!root) return false;
      const shape = cfg.shape || "array";
      if (shape === "array") {
        return Array.isArray(root) && root.some(function(row) {
          return row && String(row[cfg.idField]) === String(id);
        });
      }
      const sep = String(id).indexOf(":");
      if (sep < 0) return false;
      const outerKey = String(id).slice(0, sep);
      const innerKey = String(id).slice(sep + 1);
      const inner = root[outerKey];
      if (!inner) return false;
      if (shape === "nested") {
        return Object.prototype.hasOwnProperty.call(inner, innerKey);
      }
      if (shape === "nestedArray") {
        return Array.isArray(inner) && inner.some(function(row) {
          return row && String(row[cfg.innerIdField]) === innerKey;
        });
      }
      return false;
    }
    function _restoreDirtyFromStorage() {
      if (typeof DBService.readDirty !== "function") return;
      let snapshot = null;
      try {
        snapshot = DBService.readDirty();
      } catch (e) {
        console.warn("[AppStore] failed to read dirty-tracking snapshot; continuing with none pending.", e);
        snapshot = null;
      }
      if (!snapshot || typeof snapshot !== "object") return;
      Object.keys(_DELTA_TRACKED_SLICES).forEach(function(table) {
        const ids = snapshot[table];
        if (!Array.isArray(ids) || !ids.length) return;
        const cfg = _DELTA_TRACKED_SLICES[table];
        const validIds = ids.filter(function(id) {
          return _dirtyIdStillExists(cfg, id);
        });
        if (validIds.length) _dirty[table] = new Set(validIds);
      });
    }
    function _deepClone(obj) {
      if (obj === null || typeof obj !== "object") return obj;
      return JSON.parse(JSON.stringify(obj));
    }
    function _persist() {
      _persistDirty = true;
      if (_persistTimer) clearTimeout(_persistTimer);
      _persistTimer = setTimeout(_flushNow, 300);
    }
    function _flushNow() {
      if (!_persistDirty || _state === null) return;
      try {
        DBService.write(_state);
        _persistDirty = false;
        _persistDirtySnapshot();
      } catch (e) {
        console.error("[AppStore] _flushNow() failed:", e);
      }
      _persistTimer = null;
    }
    function _notify(event) {
      const keys = Object.keys(_subscribers);
      for (let i = 0; i < keys.length; i++) {
        try {
          _subscribers[keys[i]](_state, event || { type: "state:updated", payload: null });
        } catch (e) {
          console.error('[AppStore] subscriber "' + keys[i] + '" threw:', e);
        }
      }
    }
    async function init() {
      if (typeof DBService.initRemote === "function") {
        try {
          await DBService.initRemote();
        } catch (e) {
          console.error("[AppStore] DBService.initRemote() failed; continuing with whatever local cache is available.", e);
        }
      }
      try {
        _state = DBService.read();
        if (!_state || typeof _state !== "object") {
          console.warn("[AppStore] init: DBService.read() returned empty; using DEFAULT_DB.");
          _state = _deepClone(DEFAULT_DB);
        }
      } catch (e) {
        console.error("[AppStore] init: failed to read DB, falling back to DEFAULT_DB.", e);
        _state = _deepClone(DEFAULT_DB);
      }
      try {
        _restoreDirtyFromStorage();
      } catch (e) {
        console.warn("[AppStore] init: failed to restore dirty-tracking snapshot; continuing with none pending.", e);
      }
      try {
        window.DB = _deepClone(_state);
        window.loadDB = function() {
          var snapshot = _deepClone(_state);
          window.DB = snapshot;
          return snapshot;
        };
        window.saveDB = function() {
          AppStore.syncFromLegacy(window.DB);
        };
        document.addEventListener("visibilitychange", function() {
          if (document.visibilityState === "hidden") _flushNow();
        });
        window.addEventListener("pagehide", _flushNow);
        window.addEventListener("online", function() {
          _notify({ type: "connectivity:online", payload: null });
        });
        window.addEventListener("offline", function() {
          _notify({ type: "connectivity:offline", payload: null });
        });
        console.log("[AppStore] Initialised. State keys:", Object.keys(_state).join(", "));
      } catch (e) {
        console.error("[AppStore] init: a setup step after DBService.read() threw. AppStore.ready will still resolve, but bridge/shims may be incomplete:", e);
      }
      if (_readyResolve) _readyResolve();
    }
    function updateState(mutationFn, event) {
      if (typeof mutationFn !== "function") {
        console.error("[AppStore] updateState: mutationFn must be a function.");
        return;
      }
      const draft = _deepClone(_state);
      mutationFn(draft);
      _trackDirty(_state, draft);
      _state = draft;
      window.DB = _deepClone(_state);
      _persist();
      _notify(event || { type: "state:updated", payload: null });
    }
    function syncFromLegacy(dbOrEventType, eventType) {
      var db, evtType;
      if (dbOrEventType && typeof dbOrEventType === "object") {
        db = dbOrEventType;
        evtType = eventType;
      } else {
        evtType = dbOrEventType;
        db = window.DB;
      }
      if (!db || typeof db !== "object") return;
      var merged = _deepClone(db);
      if (_state && typeof _state === "object") {
        Object.keys(_state).forEach(function(key) {
          if (!Object.prototype.hasOwnProperty.call(db, key)) {
            merged[key] = _deepClone(_state[key]);
          }
        });
      }
      if (_state && Array.isArray(_state.classSections) && _state.classSections.length && !Object.prototype.hasOwnProperty.call(merged, "classSections")) {
        console.error("[AppStore] syncFromLegacy: classSections would be wiped by this sync \u2014 regression in the AppStore-only-slice preservation logic. Investigate before this ships.");
      }
      _state = merged;
      window.DB = _deepClone(_state);
      if (evtType === "state:remote-sync" || evtType === "state:auth-change-sync") {
        if (typeof DBService !== "undefined" && typeof DBService.mirrorLocalOnly === "function") {
          DBService.mirrorLocalOnly(_state);
        }
      } else {
        _persist();
      }
      _notify({ type: evtType || "state:legacy-sync", payload: null });
    }
    function getState() {
      var snapshot = _deepClone(_state);
      window.DB = snapshot;
      return snapshot;
    }
    function getSlice(selectorFn) {
      if (typeof selectorFn !== "function") return _deepClone(_state);
      const subTree = selectorFn(_state);
      return _deepClone(subTree);
    }
    function getStudent(studentId) {
      if (!_state || !Array.isArray(_state.students)) return null;
      const s = _state.students.find(function(st) {
        return st.id === studentId;
      });
      return s ? _deepClone(s) : null;
    }
    function getBossEvent(idx) {
      if (!_state || !Array.isArray(_state.bossEvents)) return null;
      const b = _state.bossEvents[idx];
      return b !== void 0 ? _deepClone(b) : null;
    }
    function subscribe(key, fn) {
      if (typeof fn !== "function") {
        console.error('[AppStore] subscribe: fn must be a function for key "' + key + '".');
        return;
      }
      _subscribers[key] = fn;
    }
    function unsubscribe(key) {
      delete _subscribers[key];
    }
    function flushNow() {
      _flushNow();
    }
    function getDirtyIds(table) {
      if (!_dirty[table]) return [];
      return Array.from(_dirty[table]);
    }
    function clearDirty(table, ids) {
      if (!_dirty[table] || !Array.isArray(ids)) return;
      ids.forEach(function(id) {
        _dirty[table].delete(id);
      });
      _persistDirtySnapshot();
    }
    const _readyPromise = new Promise(function(resolve) {
      _readyResolve = resolve;
    });
    init();
    function emit(event) {
      if (!event || typeof event.type !== "string") {
        console.error("[AppStore] emit: event must be an object with a string .type.");
        return;
      }
      _notify(event);
    }
    return {
      ready: _readyPromise,
      // [NEW] await this before first loadDB()/saveDB() call
      updateState,
      syncFromLegacy,
      getState,
      getSlice,
      getStudent,
      getBossEvent,
      subscribe,
      unsubscribe,
      flushNow,
      emit,
      getDirtyIds,
      // [Phase 5B] delta sync — see _DELTA_TRACKED_SLICES above
      clearDirty,
      // [Phase 5B]
      // Test-only seam (Phase 5B, mirrors db-service.js's own `_test.
      // tableSyncConfigs` seam). Not used by any runtime call site. Exists so
      // a CI test can assert AppStore's _DELTA_TRACKED_SLICES and
      // db-service.js's _TABLE_SYNC_CONFIGS' `deltaTracked` entries never
      // drift out of sync with each other — closes the "nothing enforces
      // this" gap every Phase 5B log entry has flagged since point_log.
      _test: {
        deltaTrackedSlices: _DELTA_TRACKED_SLICES
      }
    };
  })();

  // src/modules/shared/notification-service.js
  var eqTimeAgo = function(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = /* @__PURE__ */ new Date();
    const diffMs = now - d;
    if (diffMs < 0 || diffMs < 6e4) return "Just now";
    if (diffMs < 36e5) return Math.floor(diffMs / 6e4) + "m ago";
    if (diffMs < 864e5) return Math.floor(diffMs / 36e5) + "h ago";
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((nowStart - dayStart) / 864e5);
    if (dayDiff === 1) return "Yesterday";
    if (dayDiff > 1 && dayDiff < 7) return dayDiff + "d ago";
    return d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
  };
  var { eqClassifyActivity, NotificationService } = (function() {
    const NOTIF_BOOT_KEY_PREFIX = "eq_notif_bootstrapped_";
    const BOOT_POINTLOG_CAP = 30;
    const BOOT_ORDERS_CAP = 10;
    const LOCAL_NOTIF_CAP = 200;
    let _panelOpen = false;
    function _classifyPointLog(entry) {
      const what = entry.what || "";
      const pts = typeof entry.pts === "number" ? entry.pts : 0;
      let m;
      if (m = /^Quest:\s*(.+?)\s*\((\d+)%\)\s*$/.exec(what)) {
        return {
          type: "quiz",
          icon: "\u2694\uFE0F",
          action: "s-quizzes",
          title: "Quest Completed!",
          body: `You scored ${m[2]}% on "${m[1]}"${pts ? ` and earned ${pts} XP` : ""}.`
        };
      }
      if (m = /^Stage:\s*(.+)$/.exec(what)) {
        return {
          type: "campaign",
          icon: "\u{1F5FA}\uFE0F",
          action: "s-quizzes",
          title: "Campaign Stage Cleared!",
          body: `You cleared "${m[1]}"${pts ? ` and earned ${pts} XP` : ""}.`
        };
      }
      if (m = /Boss Raid:\s*"([^"]+)"/.exec(what)) {
        return {
          type: "boss",
          icon: "\u{1F479}",
          action: "s-world-boss",
          title: "Boss Defeated!",
          body: `Your party brought down ${m[1]}. Victory rewards are waiting in your inventory.`
        };
      }
      if (m = /Achievement Claimed:\s*(.+)$/.exec(what)) {
        return {
          type: "achievement",
          icon: "\u{1F3C5}",
          action: "s-badges",
          title: "Achievement Unlocked!",
          body: `You claimed the reward for "${m[1]}".`
        };
      }
      if (m = /Mail Reward:\s*(.+)$/.exec(what)) {
        return {
          type: "mail_reward",
          icon: "\u{1F4EC}",
          action: "s-mail",
          title: "Mail Reward Claimed!",
          body: `You picked up a reward attached to "${m[1]}".`
        };
      }
      if (/^Recitation/.test(what)) {
        return {
          type: "points",
          icon: "\u{1F3A4}",
          action: "s-dashboard",
          title: pts >= 0 ? "Recitation Points" : "Recitation Deduction",
          body: pts >= 0 ? `Your teacher awarded you ${pts} points for reciting in class.` : `${Math.abs(pts)} points were deducted for recitation.`
        };
      }
      if (/^Attendance/.test(what)) {
        return {
          type: "points",
          icon: "\u{1F4C5}",
          action: "s-dashboard",
          title: "Attendance Logged",
          body: `Your attendance was just recorded${pts ? ` (+${pts} pts)` : ""}.`
        };
      }
      if (pts < 0) {
        return {
          type: "points",
          icon: "\u26A0\uFE0F",
          action: "s-dashboard",
          title: "Points Deducted",
          body: `Your teacher deducted ${Math.abs(pts)} points. Tap to see your recent activity.`
        };
      }
      return {
        type: "points",
        icon: "\u2B50",
        action: "s-dashboard",
        title: "Points Awarded",
        body: `Your teacher awarded you ${pts} points. Tap to see your recent activity.`
      };
    }
    const eqClassifyActivity2 = _classifyPointLog;
    function _existingSourceIds(sid, notifications) {
      const set = /* @__PURE__ */ new Set();
      (notifications || []).forEach((n) => {
        if (n.studentId === sid && n.sourceId) set.add(n.sourceId);
      });
      return set;
    }
    function synthesize() {
      if (currentRole !== "student" || !currentUser || typeof AppStore === "undefined") return [];
      const sid = currentUser.id;
      let isBootstrap = false;
      const bootKey = NOTIF_BOOT_KEY_PREFIX + sid;
      try {
        isBootstrap = !localStorage.getItem(bootKey);
      } catch (e) {
      }
      const notifications = AppStore.getSlice((s) => s.notifications) || [];
      const existing = _existingSourceIds(sid, notifications);
      const created = [];
      let plRows = (AppStore.getSlice((s) => s.pointLog) || []).filter((p) => p.studentId === sid && p.id && !existing.has(p.id));
      if (isBootstrap) plRows = plRows.slice(0, BOOT_POINTLOG_CAP);
      plRows.forEach((p) => {
        const c = _classifyPointLog(p);
        created.push({
          id: "ntf_" + uid(),
          studentId: sid,
          type: c.type,
          icon: c.icon,
          title: c.title,
          body: c.body,
          action: c.action,
          pts: typeof p.pts === "number" ? p.pts : null,
          sourceId: p.id,
          read: isBootstrap,
          createdAt: p.createdAt || (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      let ordRows = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.studentId === sid && o.orderId && !existing.has(o.orderId));
      if (isBootstrap) ordRows = ordRows.slice(0, BOOT_ORDERS_CAP);
      ordRows.forEach((o) => {
        created.push({
          id: "ntf_" + uid(),
          studentId: sid,
          type: "store",
          icon: o.emoji || "\u{1F6CD}\uFE0F",
          // Distinct from the dashboard's "Purchased {itemName}" ledger line —
          // this is the alert version, phrased as a receipt/confirmation.
          title: "Purchase Confirmed",
          body: `Your order for "${o.itemName}" (${o.cost || 0} pts) was placed. Visit the Armory to claim it.`,
          action: "s-inventory",
          pts: -(o.cost || 0),
          sourceId: o.orderId,
          read: isBootstrap,
          createdAt: o.createdAt || (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      if (created.length) {
        AppStore.updateState((draft) => {
          if (!Array.isArray(draft.notifications)) draft.notifications = [];
          draft.notifications = created.concat(draft.notifications).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, LOCAL_NOTIF_CAP);
        }, { type: "notifications:synthesized", payload: { studentId: sid, count: created.length } });
      }
      if (isBootstrap) {
        try {
          localStorage.setItem(bootKey, "1");
        } catch (e) {
        }
        return [];
      }
      return created;
    }
    function _myNotifs() {
      if (currentRole !== "student" || !currentUser) return [];
      return (AppStore.getSlice((s) => s.notifications) || []).filter((n) => n.studentId === currentUser.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    function _unreadCount() {
      return _myNotifs().filter((n) => !n.read).length;
    }
    function _renderBadge() {
      const wrap = document.getElementById("notif-wrap");
      const badge = document.getElementById("notif-badge");
      if (!wrap || !badge) return;
      if (currentRole !== "student") {
        wrap.style.display = "none";
        return;
      }
      wrap.style.display = "";
      const n = _unreadCount();
      if (n > 0) {
        badge.style.display = "block";
        badge.textContent = n > 99 ? "99+" : String(n);
      } else {
        badge.style.display = "none";
      }
    }
    function _rowHtml(n) {
      const pts = n.pts;
      const ptsHtml = typeof pts === "number" && pts !== 0 ? `<div class="notif-row-pts" style="color:${pts > 0 ? "#4edea3" : "#ffb4ab"}">${pts > 0 ? "+" : ""}${pts}</div>` : "";
      return `
    <div class="notif-row ${n.read ? "" : "unread"}" onclick="NotificationService.openRow('${n.id}')">
      <div class="notif-row-icon">${n.icon || "\u{1F514}"}</div>
      <div class="notif-row-body">
        <div class="notif-row-title">${_esc(n.title)}</div>
        <div class="notif-row-sub">${_esc(n.body || "")}</div>
        <div class="notif-row-when">${window.eqTimeAgo(n.createdAt)}</div>
      </div>
      ${ptsHtml}
      ${n.read ? "" : '<div class="notif-row-dot"></div>'}
    </div>`;
    }
    function _renderPanel() {
      const panel = document.getElementById("notif-panel");
      if (!panel) return;
      const notifs = _myNotifs().slice(0, 40);
      const unread = notifs.filter((n) => !n.read).length;
      panel.innerHTML = `
      <div class="notif-panel-head">
        <h3>Notifications</h3>
        ${unread > 0 ? `<button class="notif-mark-all" onclick="NotificationService.markAllRead()">Mark all read</button>` : ""}
      </div>
      ${notifs.length ? notifs.map(_rowHtml).join("") : `<div class="notif-empty"><span class="emoji">\u{1F514}</span>No notifications yet.<br>Quests, rewards, and purchases will show up here.</div>`}
    `;
    }
    const NotificationService2 = {
      // Called from updateTopbar() (topbar.js) after every state refresh — the
      // one central hook already fired app-wide whenever DB changes.
      refresh: function() {
        const fresh = synthesize();
        _renderBadge();
        if (_panelOpen) _renderPanel();
        if (fresh.length === 1) {
          toast(`${fresh[0].icon || "\u{1F514}"} ${fresh[0].title}`, "#d0bcff");
        } else if (fresh.length > 1) {
          toast(`\u{1F514} You have ${fresh.length} new updates`, "#d0bcff");
        }
      },
      toggle: function() {
        const panel = document.getElementById("notif-panel");
        if (!panel) return;
        _panelOpen = !_panelOpen;
        if (_panelOpen) {
          _renderPanel();
          panel.style.display = "block";
        } else {
          panel.style.display = "none";
        }
      },
      close: function() {
        const panel = document.getElementById("notif-panel");
        if (!panel) return;
        _panelOpen = false;
        panel.style.display = "none";
      },
      markRead: function(id) {
        const existing = (AppStore.getSlice((s) => s.notifications) || []).find((x) => x.id === id);
        if (existing && !existing.read) {
          AppStore.updateState((draft) => {
            const n = (draft.notifications || []).find((x) => x.id === id);
            if (n) n.read = true;
          }, { type: "notifications:read", payload: { id } });
        }
        _renderBadge();
        if (_panelOpen) _renderPanel();
      },
      markAllRead: function() {
        const sid = currentUser && currentUser.id;
        const hasUnread = _myNotifs().some((n) => !n.read);
        if (hasUnread) {
          AppStore.updateState((draft) => {
            (draft.notifications || []).filter((n) => n.studentId === sid).forEach((n) => {
              n.read = true;
            });
          }, { type: "notifications:all-read", payload: { studentId: sid } });
        }
        _renderBadge();
        if (_panelOpen) _renderPanel();
      },
      // Click on a row: mark read, close the panel, and navigate to wherever
      // that notification is about (Quest Board, Armory Inventory, etc).
      openRow: function(id) {
        const n = (AppStore.getSlice((s) => s.notifications) || []).find((x) => x.id === id);
        if (!n) return;
        if (!n.read) {
          AppStore.updateState((draft) => {
            const target = (draft.notifications || []).find((x) => x.id === id);
            if (target) target.read = true;
          }, { type: "notifications:read", payload: { id } });
        }
        this.close();
        _renderBadge();
        if (n.action && typeof navTo === "function") navTo(n.action);
      }
    };
    document.addEventListener("click", function(e) {
      if (!_panelOpen) return;
      const panel = document.getElementById("notif-panel");
      const wrap = document.getElementById("notif-wrap");
      if (!panel || !wrap) return;
      if (wrap.contains(e.target)) return;
      if (!panel.contains(e.target)) NotificationService2.close();
    }, true);
    return { eqClassifyActivity: eqClassifyActivity2, NotificationService: NotificationService2 };
  })();
  console.log("[EduQuest] shared/notification-service.js loaded \u2014 NotificationService registered.");

  // build/test-helpers/notification-service-combined-entry.js
  window.AppStore = AppStore;
  window.eqTimeAgo = eqTimeAgo;
  window.eqClassifyActivity = eqClassifyActivity;
  window.NotificationService = NotificationService;
})();
