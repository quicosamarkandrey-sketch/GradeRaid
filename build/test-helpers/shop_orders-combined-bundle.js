(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

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

  // src/dom.js
  function toast(msg, color = "#4edea3") {
    const el = document.getElementById("toast");
    el.style.display = "block";
    el.style.borderColor = color + "55";
    el.style.boxShadow = `0 0 20px ${color}33`;
    el.innerHTML = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = "none", 2800);
  }
  function showModal(content, size = "md") {
    document.getElementById("modal-box").className = "modal-box " + size;
    document.getElementById("modal-content").innerHTML = content;
    document.getElementById("modal-overlay").style.display = "flex";
  }
  function closeModalForce() {
    document.getElementById("modal-overlay").style.display = "none";
  }

  // src/utils.js
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // src/modules/shop/shop_orders.js
  var shop_orders_exports = {};
  __export(shop_orders_exports, {
    ordCancelPrompt: () => ordCancelPrompt,
    ordExecuteCancel: () => ordExecuteCancel,
    ordLabel: () => ordLabel,
    ordStatusPill: () => ordStatusPill,
    ordSwitchTab: () => ordSwitchTab,
    ordUpdateSidebarBadge: () => ordUpdateSidebarBadge,
    renderStudentOrders: () => renderStudentOrders
  });
  var ordStatusPill = function(status) {
    const map = {
      pending: '<span class="badge-pill ord-status-pending">\u23F3 Pending</span>',
      ready: '<span class="badge-pill ord-status-ready">\u2705 Ready</span>',
      claimed: '<span class="badge-pill ord-status-claimed">\u{1F381} Claimed</span>',
      cancelled: '<span class="badge-pill ord-status-cancelled">\u274C Cancelled</span>'
    };
    return map[status] || `<span class="badge-pill bp-gray">${_esc(status)}</span>`;
  };
  var ordLabel = function(status) {
    return { pending: "\u23F3 Pending", ready: "\u2705 Ready", claimed: "\u{1F381} Claimed", cancelled: "\u274C Cancelled" }[status] || status;
  };
  var renderStudentOrders = function() {
    const st = currentUser;
    const allOrders = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.studentId === st.id);
    const active = allOrders.filter((o) => o.status === "pending" || o.status === "ready");
    const history = allOrders.filter((o) => o.status === "claimed" || o.status === "cancelled");
    const totalSpent = allOrders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + (o.cost || 0), 0);
    document.getElementById("s-orders").innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#0d1a2e,#1a0a2e)">
    <div class="page-hero-bg"></div>
    <div class="page-hero-bg2"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">\u{1F9FE} ORDER TRACKER // REWARD_CLAIMS</div>
      <h1 style="font-size:28px">My Orders</h1>
      <p>Track your reward purchases. Show your claim code to the teacher.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${active.length}</div><div class="lbl">Active</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--secondary)">${history.filter((o) => o.status === "claimed").length}</div><div class="lbl">Claimed</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${allOrders.length}</div><div class="lbl">Total Orders</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:#ffb95f">${totalSpent.toLocaleString()}</div><div class="lbl">Coins Spent</div></div>
      </div>
    </div>
  </div>

  <!-- TABS -->
  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px;overflow-x:auto">
    <button class="sord-tab active" id="sordtab-active"  onclick="ordSwitchTab('active')"><span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Active Orders ${active.length > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${active.length}</span>` : ""}</button>
    <button class="sord-tab"        id="sordtab-history" onclick="ordSwitchTab('history')"><span class="material-symbols-outlined" style="font-size:16px">history</span> Order History</button>
  </div>

  <!-- ACTIVE TAB -->
  <div id="sord-panel-active">
    ${active.length ? active.map((o) => `
    <div class="ord-row">
      <div class="ord-emoji">${o.emoji || "\u{1F381}"}</div>
      <div class="ord-info">
        <div class="ord-name">${_esc(o.itemName)}</div>
        <div class="ord-meta">
          ${ordStatusPill(o.status)}
          <span><span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">monetization_on</span> ${(o.cost || 0).toLocaleString()} coins</span>
          <span>${_esc(o.createdDateStr || "")}</span>
        </div>
        ${o.claimCode ? `<div class="ord-code">${_esc(o.claimCode)}</div>` : ""}
      </div>
      <div class="ord-actions">
        ${o.claimCode ? `<button class="btn btn-ghost btn-sm" onclick="posShowClaimCode('${o.claimCode}',{emoji:'${o.emoji || "\u{1F381}"}',name:'${_esc(o.itemName)}'},'${o.orderId}')"><span class="material-symbols-outlined" style="font-size:14px">qr_code</span> Code</button>` : ""}
        <button class="btn btn-danger btn-sm" onclick="ordCancelPrompt('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:14px">cancel</span></button>
      </div>
    </div>`).join("") : `
    <div style="text-align:center;padding:72px 20px;background:rgba(35,31,56,.7);border:1px dashed var(--border);border-radius:16px">
      <div style="font-size:48px;margin-bottom:12px">\u{1F6D2}</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:6px">No active orders</div>
      <div style="color:var(--text-muted);font-size:13px">Visit the Armory to redeem your coins!</div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="navTo('s-store')">\u{1F3EA} Visit Armory</button>
    </div>`}
  </div>

  <!-- HISTORY TAB -->
  <div id="sord-panel-history" style="display:none">
    ${history.length ? history.map((o) => `
    <div class="ord-row" style="${o.status === "cancelled" ? "opacity:.65" : ""}">
      <div class="ord-emoji" style="${o.status === "cancelled" ? "filter:grayscale(1)" : ""}">${o.emoji || "\u{1F381}"}</div>
      <div class="ord-info">
        <div class="ord-name">${_esc(o.itemName)}</div>
        <div class="ord-meta">
          ${ordStatusPill(o.status)}
          <span><span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">monetization_on</span> ${(o.cost || 0).toLocaleString()} coins</span>
          <span>${_esc(o.createdDateStr || "")}</span>
          ${o.claimedAt ? `<span>\xB7 Claimed ${new Date(o.claimedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>` : ""}
          ${o.cancelReason ? `<span style="color:#ffb4ab">\xB7 ${_esc(o.cancelReason)}</span>` : ""}
        </div>
      </div>
    </div>`).join("") : `
    <div style="text-align:center;padding:60px;color:var(--text-muted);font-size:13px">
      <div style="font-size:40px;margin-bottom:12px">\u{1F4CB}</div>
      <div>No order history yet.</div>
    </div>`}
  </div>`;
    ordUpdateSidebarBadge();
  };
  var ordSwitchTab = function(tab) {
    ["active", "history"].forEach((t) => {
      const btn = document.getElementById("sordtab-" + t);
      const panel = document.getElementById("sord-panel-" + t);
      if (btn) btn.classList.toggle("active", t === tab);
      if (panel) panel.style.display = t === tab ? "block" : "none";
    });
  };
  var ordCancelPrompt = function(orderId) {
    const order = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!order) return;
    showModal(`<div>
    <div class="modal-h2">Cancel Order?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
      Cancel <b style="color:var(--on-surface)">${_esc(order.itemName)}</b>?
    </div>
    <div style="background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.2);border-radius:12px;padding:14px;margin-bottom:16px;font-size:12px;color:#ffb4ab">
      \u26A0\uFE0F Coins are not automatically refunded. Ask your teacher if you need a refund.
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Order</button>
      <button class="btn btn-danger" style="flex:1" onclick="ordExecuteCancel('${orderId}')">Cancel Order</button>
    </div>
  </div>`, "sm");
  };
  var ordExecuteCancel = function(orderId) {
    const existing = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!existing) {
      closeModalForce();
      return;
    }
    AppStore.updateState((draft) => {
      const order = (draft.orders || []).find((o) => o.orderId === orderId);
      if (!order) return;
      order.status = "cancelled";
      order.cancelledAt = Date.now();
      order.cancelReason = "Cancelled by student";
      order.cancelledBy = currentUser.name || "Student";
    }, { type: "shop:order-cancelled", payload: { orderId } });
    closeModalForce();
    toast("\u{1F6AB} Order cancelled.", "#ffb4ab");
    renderStudentOrders();
  };
  var ordUpdateSidebarBadge = function() {
    const btn = document.getElementById("nav-s-orders");
    if (!btn) return;
    const active = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.studentId === currentUser?.id && (o.status === "pending" || o.status === "ready"));
    const old = btn.querySelector(".ord-nav-badge");
    if (old) old.remove();
    if (active.length > 0) {
      const badge = document.createElement("span");
      badge.className = "ord-nav-badge";
      badge.textContent = active.length > 99 ? "99+" : String(active.length);
      badge.style.cssText = "margin-left:auto;background:rgba(255,185,95,0.2);border:1px solid rgba(255,185,95,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--tertiary);font-family:var(--fh)";
      btn.appendChild(badge);
    }
  };
  AppStore.subscribe("shop-orders-boot-badge", function(state, event) {
    if (event.type !== "session:booted") return;
    if (currentRole === "student") setTimeout(ordUpdateSidebarBadge, 55);
  });
  console.log("[EduQuest] shop/orders.js loaded \u2014 renderStudentOrders, ord* helpers, ordUpdateSidebarBadge registered.");

  // build/test-helpers/shop_orders-combined-entry.js
  window.AppStore = AppStore;
  window.toast = toast;
  window.showModal = showModal;
  window.closeModalForce = closeModalForce;
  window._esc = _esc;
  Object.keys(shop_orders_exports).forEach((k) => {
    window[k] = shop_orders_exports[k];
  });
})();
