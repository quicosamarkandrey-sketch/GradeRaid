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
  function todayStr() {
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }
  function nowStr() {
    return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
  }

  // src/modules/shop/shop_inventory.js
  var shop_inventory_exports = {};
  __export(shop_inventory_exports, {
    INV_CAT_COLORS: () => INV_CAT_COLORS,
    INV_CAT_ICONS: () => INV_CAT_ICONS,
    INV_CAT_LABELS: () => INV_CAT_LABELS,
    invConfirmUse: () => invConfirmUse,
    invFilter: () => invFilter,
    invHistFilter: () => invHistFilter,
    invShowCodes: () => invShowCodes,
    invSwitchTab: () => invSwitchTab,
    invUpdateSidebarBadge: () => invUpdateSidebarBadge,
    invUseItem: () => invUseItem,
    invViewDetail: () => invViewDetail,
    renderInventory: () => renderInventory
  });
  var INV_CAT_LABELS = { food: "Food", supplies: "Supplies", privilege: "Privilege", mystery: "Mystery", unknown: "Other" };
  var INV_CAT_ICONS = { food: "\u{1F354}", supplies: "\u{1F4E6}", privilege: "\u2B50", mystery: "\u2753", unknown: "\u{1F381}" };
  var INV_CAT_COLORS = { food: "var(--secondary)", supplies: "var(--primary)", privilege: "var(--tertiary)", mystery: "#fb923c", unknown: "var(--text-muted)" };
  var renderInventory = function() {
    const st = currentUser;
    const inventory = AppStore.getSlice((s) => s.inventory) || {};
    const inv = inventory[st.id] || [];
    const redemptions = (AppStore.getSlice((s) => s.redemptions) || []).filter((r) => r.studentId === st.id);
    const totalSpent = redemptions.reduce((s, r) => s + (r.pts || 0), 0);
    const totalItems = inv.reduce((s, i) => s + (i.quantity || 1), 0);
    const uniqueItems = inv.length;
    document.getElementById("s-inventory").innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#1a0a2e,#0d1a2e)">
    <div class="page-hero-bg"></div>
    <div class="page-hero-bg2"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">\u{1F392} ITEM REGISTRY // OWNED_ITEMS</div>
      <h1 style="font-size:30px">My Inventory</h1>
      <p>All items you've redeemed from the Armory, tracked and organized.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${uniqueItems}</div><div class="lbl">Unique Items</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--secondary)">${totalItems}</div><div class="lbl">Total Owned</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${totalSpent.toLocaleString()}</div><div class="lbl">Coins Spent</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:#fb923c">${redemptions.length}</div><div class="lbl">Purchases</div></div>
      </div>
    </div>
  </div>

  <div class="inv-tab-row" id="inv-tab-row">
    <button class="inv-tab active" id="invtab-items"   onclick="invSwitchTab('items')"><span class="material-symbols-outlined">inventory_2</span> Items</button>
    <button class="inv-tab"        id="invtab-history" onclick="invSwitchTab('history')"><span class="material-symbols-outlined">history</span> Purchase History</button>
  </div>

  <div id="inv-panel-items">
    <div class="inv-toolbar">
      <div class="inv-search-wrap">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">search</span>
        <input type="text" id="inv-search" placeholder="Search items\u2026" oninput="invFilter()" style="background:none;border:none;outline:none;color:var(--text);font-family:var(--fb);font-size:14px;flex:1;min-width:0">
      </div>
      <div class="inv-filter-row">
        <select id="inv-cat-filter"    onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option><option value="food">\u{1F354} Food</option><option value="supplies">\u270F\uFE0F Supplies</option><option value="privilege">\u2B50 Privilege</option><option value="mystery">\u2753 Mystery</option>
        </select>
        <select id="inv-status-filter" onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Status</option><option value="active">Active</option><option value="used">Used</option>
        </select>
        <select id="inv-sort"          onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="recent">Recently Added</option><option value="name">Name A\u2013Z</option><option value="qty-desc">Quantity \u2193</option><option value="qty-asc">Quantity \u2191</option>
        </select>
      </div>
    </div>
    <div id="inv-results-count" style="font-size:12px;color:var(--text-muted);margin-bottom:16px;font-weight:600"></div>
    <div id="inv-grid" class="inv-grid"></div>
  </div>

  <div id="inv-panel-history" style="display:none">
    <div class="inv-toolbar">
      <div class="inv-search-wrap">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">search</span>
        <input type="text" id="inv-hist-search" placeholder="Search history\u2026" oninput="invHistFilter()" style="background:none;border:none;outline:none;color:var(--text);font-family:var(--fb);font-size:14px;flex:1;min-width:0">
      </div>
      <div class="inv-filter-row">
        <select id="inv-hist-cat" onchange="invHistFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option><option value="food">\u{1F354} Food</option><option value="supplies">\u270F\uFE0F Supplies</option><option value="privilege">\u2B50 Privilege</option><option value="mystery">\u2753 Mystery</option>
        </select>
      </div>
    </div>
    <div id="inv-hist-count" style="font-size:12px;color:var(--text-muted);margin-bottom:16px;font-weight:600"></div>
    <div id="inv-hist-list" class="inv-hist-list"></div>
  </div>`;
    invFilter();
    invHistFilter();
  };
  var invSwitchTab = function(tab) {
    ["items", "history"].forEach((t) => {
      const btn = document.getElementById("invtab-" + t);
      const panel = document.getElementById("inv-panel-" + t);
      if (btn) btn.classList.toggle("active", t === tab);
      if (panel) panel.style.display = t === tab ? "block" : "none";
    });
  };
  var invFilter = function() {
    const st = currentUser;
    const inventory = AppStore.getSlice((s) => s.inventory) || {};
    let inv = inventory[st.id] ? [...inventory[st.id]] : [];
    const q = (document.getElementById("inv-search")?.value || "").toLowerCase().trim();
    const cat = document.getElementById("inv-cat-filter")?.value || "all";
    const statusF = document.getElementById("inv-status-filter")?.value || "all";
    const sort = document.getElementById("inv-sort")?.value || "recent";
    if (q) inv = inv.filter((i) => (i.itemName || "").toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q));
    if (cat !== "all") inv = inv.filter((i) => i.category === cat);
    if (statusF !== "all") inv = inv.filter((i) => (i.status || "active") === statusF);
    if (sort === "name") inv.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));
    else if (sort === "qty-desc") inv.sort((a, b) => (b.quantity || 1) - (a.quantity || 1));
    else if (sort === "qty-asc") inv.sort((a, b) => (a.quantity || 1) - (b.quantity || 1));
    const countEl = document.getElementById("inv-results-count");
    if (countEl) countEl.textContent = `Showing ${inv.length} item${inv.length !== 1 ? "s" : ""}`;
    const grid = document.getElementById("inv-grid");
    if (!grid) return;
    if (!inv.length) {
      const isEmpty = !q && cat === "all" && statusF === "all";
      grid.innerHTML = `<div class="inv-empty">
      <div style="font-size:56px;margin-bottom:16px">\u{1F392}</div>
      <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:8px;color:var(--on-surface)">${isEmpty ? "Inventory Empty" : "No items match"}</div>
      <div style="color:var(--text-muted);font-size:13px;max-width:280px;margin:0 auto">${isEmpty ? "Visit the Armory to redeem your first item!" : "Try adjusting your search or filters."}</div>
      ${isEmpty ? `<button class="btn btn-primary" style="margin-top:20px" onclick="navTo('s-store')">\u{1F6CD}\uFE0F Visit Armory</button>` : ""}
    </div>`;
      return;
    }
    const allStore = AppStore.getSlice((s) => s.store) || [];
    const allOrders = AppStore.getSlice((s) => s.orders) || [];
    grid.innerHTML = inv.map((item) => {
      const isUsed = (item.status || "active") === "used";
      const catColor = INV_CAT_COLORS[item.category] || "var(--text-muted)";
      const catLabel = INV_CAT_LABELS[item.category] || "Other";
      const qty = item.quantity || 1;
      const storeItem = allStore.find((s) => s.id === item.itemId);
      const rarity = storeItem ? getItemRarity(storeItem) : { label: "Common", cls: "rarity-common" };
      const pending = allOrders.filter((o) => o.studentId === currentUser.id && o.itemId === item.itemId && o.status === "pending");
      return `<div class="inv-card ${isUsed ? "inv-card-used" : ""}">
      <div class="inv-card-top">
        <div class="inv-qty-badge ${qty > 1 ? "inv-qty-multi" : ""}">${qty}\xD7</div>
        ${pending.length ? `<div class="inv-pending-dot" title="${pending.length} unclaimed"></div>` : ""}
        ${isUsed ? `<div class="inv-used-badge">USED</div>` : ""}
      </div>
      <div class="inv-emoji">${item.emoji || "\u{1F381}"}</div>
      <div class="inv-rarity"><span class="rarity-pill ${rarity.cls}">${rarity.label}</span></div>
      <div class="inv-name">${_esc(item.itemName)}</div>
      <div class="inv-cat-pill" style="color:${catColor};border-color:${catColor}33;background:${catColor}11">
        ${INV_CAT_ICONS[item.category] || "\u{1F381}"} ${catLabel}
      </div>
      <div class="inv-date"><span class="material-symbols-outlined" style="font-size:12px">calendar_today</span>${_esc(item.datePurchased || "")}</div>
      <div class="inv-source"><span class="material-symbols-outlined" style="font-size:12px">storefront</span>${_esc(item.source || "Store")}</div>
      ${pending.length ? `<button class="inv-code-btn" onclick="invShowCodes('${item.itemId}')"><span class="material-symbols-outlined" style="font-size:13px">qr_code</span> Show Claim Code${pending.length > 1 ? " (" + pending.length + ")" : ""}</button>` : ""}
      <div class="inv-card-actions">
        ${!isUsed && item.category === "privilege" ? `<button class="inv-use-btn" onclick="invUseItem('${item.itemId}')">Use Item</button>` : ""}
        <button class="inv-detail-btn" onclick="invViewDetail('${item.itemId}')">Details</button>
      </div>
    </div>`;
    }).join("");
  };
  var invHistFilter = function() {
    const allStore = AppStore.getSlice((s) => s.store) || [];
    const allOrders = AppStore.getSlice((s) => s.orders) || [];
    let records = (AppStore.getSlice((s) => s.redemptions) || []).filter((r) => r.studentId === currentUser.id);
    const q = (document.getElementById("inv-hist-search")?.value || "").toLowerCase().trim();
    const cat = document.getElementById("inv-hist-cat")?.value || "all";
    if (q) records = records.filter((r) => (r.itemName || r.item || "").toLowerCase().includes(q));
    if (cat !== "all") records = records.filter((r) => {
      const s = allStore.find((x) => x.id === r.itemId);
      return s && s.cat === cat;
    });
    const countEl = document.getElementById("inv-hist-count");
    if (countEl) countEl.textContent = `${records.length} purchase${records.length !== 1 ? "s" : ""}`;
    const list = document.getElementById("inv-hist-list");
    if (!list) return;
    if (!records.length) {
      list.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);font-size:13px">
      <div style="font-size:40px;margin-bottom:12px">\u{1F4CB}</div>
      <div style="font-weight:700;margin-bottom:4px">No purchase history</div>
      <div>${q || cat !== "all" ? "No records match your filters." : "Redeem items from the Armory to see history here."}</div>
    </div>`;
      return;
    }
    list.innerHTML = records.map((r) => {
      const storeItem = allStore.find((s) => s.id === r.itemId);
      const catLabel = storeItem ? INV_CAT_LABELS[storeItem.cat] : "Store";
      const catColor = storeItem ? INV_CAT_COLORS[storeItem.cat] : "var(--text-muted)";
      const emoji = r.emoji || (storeItem ? storeItem.emoji : "\u{1F381}");
      const name = r.itemName || r.item || "Unknown Item";
      const order = r.orderId ? allOrders.find((o) => o.orderId === r.orderId) : null;
      const statusColor = { pending: "#ffb95f", claimed: "#4edea3", cancelled: "#ffb4ab" }[order?.status] || "var(--text-muted)";
      const statusLabel = { pending: "\u23F3 Pending", claimed: "\u2705 Claimed", cancelled: "\u274C Cancelled" }[order?.status] || "";
      return `<div class="inv-hist-row">
      <div class="inv-hist-emoji">${emoji}</div>
      <div class="inv-hist-info">
        <div class="inv-hist-name">${_esc(name)}</div>
        <div class="inv-hist-meta">
          <span style="color:${catColor}">${catLabel}</span>
          <span style="color:var(--border2)">\xB7</span>
          <span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">calendar_today</span>
          ${_esc(r.date || "Unknown date")}
          ${r.time ? `<span style="color:var(--border2)">\xB7</span>${_esc(r.time)}` : ""}
          ${order ? `<span style="color:var(--border2)">\xB7</span><span style="color:${statusColor};font-weight:700">${statusLabel}</span>` : ""}
        </div>
        ${r.claimCode ? `<div style="margin-top:5px;display:flex;align-items:center;gap:6px">
          <span style="font-family:var(--fm);font-size:12px;color:var(--secondary);letter-spacing:.1em">${_esc(r.claimCode)}</span>
          ${order && order.status === "pending" ? `<button onclick="posShowClaimCode('${r.claimCode}',{emoji:'${emoji}',name:'${_esc(name)}'},${r.orderId ? `'${r.orderId}'` : "null"})" style="background:rgba(78,222,163,0.1);border:1px solid rgba(78,222,163,0.25);color:var(--secondary);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--fb)">Show Code</button>` : ""}
        </div>` : ""}
      </div>
      <div class="inv-hist-cost">
        <span class="material-symbols-outlined" style="font-size:14px;color:var(--tertiary);font-variation-settings:'FILL' 1">monetization_on</span>
        <span style="font-family:var(--fh);font-weight:800;color:var(--tertiary)">${(r.pts || 0).toLocaleString()}</span>
      </div>
    </div>`;
    }).join("");
  };
  var invUseItem = function(itemId) {
    const inv = (AppStore.getSlice((s) => s.inventory) || {})[currentUser.id];
    if (!inv) return;
    const item = inv.find((i) => i.itemId === itemId);
    if (!item || item.status === "used") {
      toast("\u26A0\uFE0F Item already used or not found.", "#ffb4ab");
      return;
    }
    const storeItem = (AppStore.getSlice((s) => s.store) || []).find((s) => s.id === itemId);
    showModal(`<div style="text-align:center">
    <div style="font-size:56px;margin-bottom:12px">${item.emoji || "\u{1F381}"}</div>
    <div class="modal-h2" style="text-align:center">Use ${_esc(item.itemName)}?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px;line-height:1.6">${storeItem ? _esc(storeItem.desc) : "This will mark the item as used."}</div>
    <div style="background:rgba(255,185,95,0.08);border:1px solid rgba(255,185,95,0.2);border-radius:12px;padding:12px;margin-bottom:20px;font-size:13px;color:var(--tertiary)">
      \u26A0\uFE0F This action cannot be undone. The item will be marked as used.
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="invConfirmUse('${itemId}')">\u2705 Confirm Use</button>
    </div>
  </div>`, "sm");
  };
  var invConfirmUse = function(itemId) {
    const existingList = (AppStore.getSlice((s) => s.inventory) || {})[currentUser.id];
    if (!existingList) {
      closeModalForce();
      return;
    }
    const existing = existingList.find((i) => i.itemId === itemId);
    if (!existing) {
      closeModalForce();
      return;
    }
    let itemLabel = null;
    AppStore.updateState((draft) => {
      const list = draft.inventory && draft.inventory[currentUser.id];
      if (!list) return;
      const item = list.find((i) => i.itemId === itemId);
      if (!item) return;
      item.status = "used";
      item.usedAt = todayStr() + " at " + nowStr();
      if (item.quantity > 1) {
        item.quantity--;
        item.status = "active";
      }
      itemLabel = `${item.emoji} ${_esc(item.itemName)}`;
    }, { type: "shop:item-used", payload: { studentId: currentUser.id, itemId } });
    closeModalForce();
    toast(`\u2705 ${itemLabel || existing.emoji + " " + _esc(existing.itemName)} used!`, "#4edea3");
    renderInventory();
  };
  var invViewDetail = function(itemId) {
    const inv = (AppStore.getSlice((s) => s.inventory) || {})[currentUser.id] || [];
    const item = inv.find((i) => i.itemId === itemId);
    if (!item) {
      toast("Item not found.", "#ffb4ab");
      return;
    }
    const storeItem = (AppStore.getSlice((s) => s.store) || []).find((s) => s.id === itemId);
    const rarity = storeItem ? getItemRarity(storeItem) : { label: "Common", cls: "rarity-common" };
    const purchases = (AppStore.getSlice((s) => s.redemptions) || []).filter((r) => r.studentId === currentUser.id && r.itemId === itemId);
    const catColor = INV_CAT_COLORS[item.category] || "var(--text-muted)";
    showModal(`<div style="text-align:center">
    <div style="font-size:60px;margin-bottom:10px">${item.emoji || "\u{1F381}"}</div>
    <span class="rarity-pill ${rarity.cls}" style="margin-bottom:12px;display:inline-block">${rarity.label}</span>
    <div class="modal-h2" style="text-align:center;margin-bottom:4px">${_esc(item.itemName)}</div>
    <div style="color:${catColor};font-size:12px;font-weight:700;margin-bottom:16px">${INV_CAT_ICONS[item.category] || "\u{1F381}"} ${INV_CAT_LABELS[item.category] || "Store"}</div>
    ${storeItem ? `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--text-muted);line-height:1.6;text-align:left">${_esc(storeItem.desc)}</div>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--primary)">${item.quantity || 1}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Owned</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--tertiary)">${purchases.length}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Purchases</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--tertiary)">${storeItem?.cost || "?"}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Coins Each</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">
      First purchased: ${_esc(item.datePurchased || "Unknown")}<br>Source: ${_esc(item.source || "Store")}
    </div>
    <div style="display:flex;gap:10px">
      ${(item.status || "active") !== "used" && item.category === "privilege" ? `<button class="btn btn-primary" style="flex:1" onclick="closeModalForce();invUseItem('${itemId}')">Use Item</button>` : ""}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
    </div>
  </div>`, "sm");
  };
  var invShowCodes = function(itemId) {
    const orders = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.studentId === currentUser.id && o.itemId === itemId && o.status === "pending");
    if (!orders.length) {
      toast("No pending orders for this item.", "#ffb4ab");
      return;
    }
    const item = (AppStore.getSlice((s) => s.store) || []).find((s) => s.id === itemId);
    const emoji = item ? item.emoji : "\u{1F381}";
    const name = item ? item.name : orders[0].itemName || "Item";
    if (orders.length === 1) {
      posShowClaimCode(orders[0].claimCode, { emoji, name }, orders[0].orderId);
      return;
    }
    showModal(`<div>
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:44px;margin-bottom:8px">${emoji}</div>
      <div class="modal-h2" style="text-align:center;margin-bottom:4px">${_esc(name)}</div>
      <div style="font-size:13px;color:var(--text-muted)">${orders.length} pending orders</div>
    </div>
    ${orders.map((o, i) => `
    <div style="background:rgba(78,222,163,0.06);border:1px solid rgba(78,222,163,0.2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text-muted)">Order ${i + 1}</div>
        <div style="font-size:10px;color:var(--text-muted)">${_esc(o.createdDateStr || "")}</div>
      </div>
      <div style="font-family:var(--fm);font-size:22px;font-weight:900;color:var(--secondary);letter-spacing:.16em;text-align:center;text-shadow:0 0 16px rgba(78,222,163,0.3)">${_esc(o.claimCode)}</div>
    </div>`).join("")}
    <button class="btn btn-ghost btn-block" style="margin-top:4px" onclick="closeModalForce()">Close</button>
  </div>`, "md");
  };
  var invUpdateSidebarBadge = function() {
    const btn = document.getElementById("nav-s-inventory");
    if (!btn) return;
    const total = ((AppStore.getSlice((s) => s.inventory) || {})[currentUser?.id] || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const old = btn.querySelector(".inv-nav-badge");
    if (old) old.remove();
    if (total > 0) {
      const badge = document.createElement("span");
      badge.className = "inv-nav-badge";
      badge.textContent = total > 99 ? "99+" : String(total);
      badge.style.cssText = "margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)";
      btn.appendChild(badge);
    }
  };
  AppStore.subscribe("shop-inventory-boot-badge", function(state, event) {
    if (event.type !== "session:booted") return;
    if (currentRole === "student") setTimeout(invUpdateSidebarBadge, 50);
  });
  AppStore.subscribe("shop-inventory-sidebar-badge", function(state, event) {
    if (event.type !== "nav:sidebar-rendered") return;
    if (currentRole === "student") setTimeout(invUpdateSidebarBadge, 20);
  });
  console.log("[EduQuest] shop/inventory.js loaded \u2014 renderInventory, inv* helpers, invUpdateSidebarBadge registered.");

  // build/test-helpers/shop_inventory-combined-entry.js
  window.AppStore = AppStore;
  window.toast = toast;
  window.showModal = showModal;
  window.closeModalForce = closeModalForce;
  window._esc = _esc;
  window.todayStr = todayStr;
  window.nowStr = nowStr;
  Object.keys(shop_inventory_exports).forEach((k) => {
    window[k] = shop_inventory_exports[k];
  });
})();
