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
  function uid() {
    return "id_" + Math.random().toString(36).substr(2, 9);
  }
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // src/modules/shop/shop_promotions.js
  var shop_promotions_exports = {};
  __export(shop_promotions_exports, {
    PROMO_TYPES: () => PROMO_TYPES,
    promoActivateSlide: () => promoActivateSlide,
    promoAdminConfirmDelete: () => promoAdminConfirmDelete,
    promoAdminDelete: () => promoAdminDelete,
    promoAdminOpenForm: () => promoAdminOpenForm,
    promoAdminPreview: () => promoAdminPreview,
    promoAdminPreviewStore: () => promoAdminPreviewStore,
    promoAdminSaveForm: () => promoAdminSaveForm,
    promoAdminToggle: () => promoAdminToggle,
    promoBuildSlideHTML: () => promoBuildSlideHTML,
    promoCarousel: () => promoCarousel,
    promoClickBanner: () => promoClickBanner,
    promoCountdownInterval: () => promoCountdownInterval,
    promoCountdownStr: () => promoCountdownStr,
    promoFormTypeChange: () => promoFormTypeChange,
    promoGetActive: () => promoGetActive,
    promoGetAutoLabel: () => promoGetAutoLabel,
    promoGetCardBadge: () => promoGetCardBadge,
    promoGoTo: () => promoGoTo,
    promoIsActive: () => promoIsActive,
    promoNav: () => promoNav,
    promoRecordClick: () => promoRecordClick,
    promoRecordPurchase: () => promoRecordPurchase,
    promoRecordView: () => promoRecordView,
    promoRenderCarousel: () => promoRenderCarousel,
    promoStartCountdownTick: () => promoStartCountdownTick,
    promoTypeConfig: () => promoTypeConfig,
    renderAdminPromotions: () => renderAdminPromotions
  });
  var PROMO_TYPES = [
    { value: "new", label: "\u{1F195} New Item", tagLabel: "NEW", btnColor: "#8b5cf6" },
    { value: "hot", label: "\u{1F525} Hot Item", tagLabel: "\u{1F525} HOT", btnColor: "#f97316" },
    { value: "sale", label: "\u{1F4B0} Sale", tagLabel: "SALE", btnColor: "#ef4444" },
    { value: "limited", label: "\u23F0 Limited Offer", tagLabel: "LIMITED", btnColor: "#ffb95f" },
    { value: "featured", label: "\u2B50 Featured Reward", tagLabel: "FEATURED", btnColor: "#4edea3" },
    { value: "event", label: "\u{1F389} Event Promotion", tagLabel: "EVENT", btnColor: "#EC4899" },
    { value: "seasonal", label: "\u{1F338} Seasonal", tagLabel: "SEASONAL", btnColor: "#8b5cf6" },
    { value: "custom", label: "\u270F\uFE0F Custom", tagLabel: "PROMO", btnColor: "#60a5fa" }
  ];
  var promoTypeConfig = function(type) {
    return PROMO_TYPES.find((t) => t.value === type) || PROMO_TYPES[PROMO_TYPES.length - 1];
  };
  var promoIsActive = function(p) {
    if (!p.active) return false;
    const now = /* @__PURE__ */ new Date();
    if (p.startDate && new Date(p.startDate) > now) return false;
    if (p.endDate && new Date(p.endDate) < now) return false;
    return true;
  };
  var promoGetActive = function() {
    return (AppStore.getSlice((s) => s.promotions) || []).filter(promoIsActive).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  };
  var promoRecordView = function(id) {
    if (!id) return;
    AppStore.updateState((draft) => {
      if (!draft.promoAnalytics) draft.promoAnalytics = {};
      if (!draft.promoAnalytics[id]) draft.promoAnalytics[id] = { views: 0, clicks: 0, purchases: 0 };
      draft.promoAnalytics[id].views++;
    }, { type: "shop:promo-viewed", payload: { id } });
  };
  var promoRecordClick = function(id) {
    if (!id) return;
    AppStore.updateState((draft) => {
      if (!draft.promoAnalytics) draft.promoAnalytics = {};
      if (!draft.promoAnalytics[id]) draft.promoAnalytics[id] = { views: 0, clicks: 0, purchases: 0 };
      draft.promoAnalytics[id].clicks++;
    }, { type: "shop:promo-clicked", payload: { id } });
  };
  var promoRecordPurchase = function(itemId, draftState) {
    const apply = (state) => {
      if (!state.promoAnalytics) state.promoAnalytics = {};
      (state.promotions || []).filter((p) => p.linkedItemId === itemId && promoIsActive(p)).forEach((p) => {
        if (!state.promoAnalytics[p.id]) state.promoAnalytics[p.id] = { views: 0, clicks: 0, purchases: 0 };
        state.promoAnalytics[p.id].purchases++;
      });
    };
    if (draftState) {
      apply(draftState);
    } else {
      AppStore.updateState(apply, { type: "shop:promo-purchase-recorded", payload: { itemId } });
    }
  };
  var promoGetAutoLabel = function(item) {
    const now = /* @__PURE__ */ new Date();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1e3);
    if (item._promoLabel) return item._promoLabel;
    if (item.addedAt && new Date(item.addedAt) >= twoDaysAgo) return "new";
    if (item.stock !== void 0 && item.stock <= 3 && item.stock > 0) return "limited";
    const count = (AppStore.getSlice((s) => s.redemptions) || []).filter((r) => r.itemId === item.id).length;
    if (count >= 3) return "hot";
    return null;
  };
  var promoCountdownStr = function(endDate) {
    if (!endDate) return null;
    const diff = new Date(endDate) - /* @__PURE__ */ new Date();
    if (diff <= 0) return null;
    const d = Math.floor(diff / 864e5);
    const h = Math.floor(diff % 864e5 / 36e5);
    const m = Math.floor(diff % 36e5 / 6e4);
    if (d > 0) return `\u23F0 ${d}d ${h}h left`;
    if (h > 0) return `\u23F0 ${h}h ${m}m left`;
    return `\u23F0 ${m}m left`;
  };
  var promoCarousel = { idx: 0, slides: [], timer: null, interval: 6e3 };
  var promoBuildSlideHTML = function(p) {
    const cfg = promoTypeConfig(p.type);
    const item = p.linkedItemId ? (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === p.linkedItemId) : null;
    const emoji = p.image || item?.emoji || "\u{1F381}";
    const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
    const tagLabel = p.adminLabel || (p.type === "custom" && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
    const price = item ? item.cost : null;
    return `<div class="promo-slide type-${p.type}" id="promo-slide-${p.id}">
    <div class="promo-slide-bg"></div>
    <div class="promo-slide-content" onclick="promoClickBanner('${p.id}')">
      <div class="promo-slide-inner">
        ${countdown ? `<div class="promo-countdown${new Date(p.endDate) - /* @__PURE__ */ new Date() < 36e5 ? " urgent" : ""}">${countdown}</div>` : ""}
        <span class="promo-tag type-${p.type}">${tagLabel}</span>
        <div class="promo-title">${_esc(p.title)}</div>
        <div class="promo-sub">${_esc(p.subtitle || "")}</div>
        <div class="promo-cta">
          ${price !== null ? `<div class="promo-price"><span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">monetization_on</span>${price}</div>` : ""}
          <button class="promo-btn" onclick="event.stopPropagation();promoClickBanner('${p.id}')">${item ? "Redeem" : "View \u2192"}</button>
        </div>
      </div>
      <div class="promo-slide-emoji">${emoji}</div>
    </div>
  </div>`;
  };
  var promoRenderCarousel = function() {
    const wrap = document.getElementById("promo-carousel-wrap");
    if (!wrap) return;
    const active = promoGetActive();
    if (!active.length) {
      wrap.innerHTML = `<div class="promo-empty-banner">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,rgba(26,20,56,0.98),rgba(139,92,246,0.15));display:flex;align-items:center;padding:0 32px">
        <div class="store-banner-inner">
          <span class="store-banner-tag">\u{1F3EA} Welcome</span>
          <div class="store-banner-title">The Armory</div>
          <div class="store-banner-sub">Browse all available rewards and exchange your coins!</div>
        </div>
        <div style="font-size:96px;margin-left:auto;padding-right:32px;filter:drop-shadow(0 0 32px rgba(255,185,95,0.4))">\u2694\uFE0F</div>
      </div>
    </div>`;
      return;
    }
    promoRecordView(active[promoCarousel.idx % active.length]?.id);
    const slidesHTML = active.map((p) => promoBuildSlideHTML(p)).join("");
    const dotsHTML = active.length > 1 ? active.map((_, i) => `<span class="promo-dot${i === 0 ? " active" : ""}" onclick="promoGoTo(${i})"></span>`).join("") : "";
    wrap.innerHTML = `<div class="promo-carousel" id="promo-carousel">
    ${slidesHTML}
    ${active.length > 1 ? `<div class="promo-carousel-controls">
      <button class="promo-nav-btn" onclick="event.stopPropagation();promoNav(-1)">\u2039</button>
      ${dotsHTML}
      <button class="promo-nav-btn" onclick="event.stopPropagation();promoNav(1)">\u203A</button>
    </div>` : ""}
  </div>`;
    promoCarousel.slides = active;
    promoCarousel.idx = 0;
    promoActivateSlide(0);
    if (promoCarousel.timer) clearInterval(promoCarousel.timer);
    if (active.length > 1) {
      const interval = active[0].rotationInterval ? active[0].rotationInterval * 1e3 : 6e3;
      promoCarousel.timer = setInterval(() => promoNav(1), interval);
    }
  };
  function promoActivateSlide(idx) {
    const slides = promoCarousel.slides;
    if (!slides.length) return;
    idx = (idx % slides.length + slides.length) % slides.length;
    promoCarousel.idx = idx;
    document.querySelectorAll(".promo-slide").forEach((el, i) => {
      el.classList.remove("active", "exit");
      if (i === idx) el.classList.add("active");
    });
    document.querySelectorAll(".promo-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
    promoRecordView(slides[idx]?.id);
  }
  var promoNav = function(dir) {
    promoActivateSlide(promoCarousel.idx + dir);
    if (promoCarousel.timer) {
      clearInterval(promoCarousel.timer);
      const slides = promoCarousel.slides;
      if (slides.length > 1) {
        const interval = slides[promoCarousel.idx]?.rotationInterval ? slides[promoCarousel.idx].rotationInterval * 1e3 : 6e3;
        promoCarousel.timer = setInterval(() => promoNav(1), interval);
      }
    }
  };
  var promoGoTo = function(idx) {
    promoActivateSlide(idx);
    if (promoCarousel.timer) {
      clearInterval(promoCarousel.timer);
      const slides = promoCarousel.slides;
      if (slides.length > 1) {
        const interval = slides[promoCarousel.idx]?.rotationInterval ? slides[promoCarousel.idx].rotationInterval * 1e3 : 6e3;
        promoCarousel.timer = setInterval(() => promoNav(1), interval);
      }
    }
  };
  var promoClickBanner = function(id) {
    promoRecordClick(id);
    const p = (AppStore.getSlice((s) => s.promotions) || []).find((x) => x.id === id);
    if (!p) return;
    if (p.linkedItemId) {
      const item = (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === p.linkedItemId);
      if (item) {
        renderStudentStore(item.cat);
        showPage("s-store");
        setTimeout(() => {
          const el = document.getElementById("store-item-" + p.linkedItemId);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.style.boxShadow = "0 0 32px rgba(208,188,255,0.5)";
            setTimeout(() => el.style.boxShadow = "", 1800);
          }
        }, 300);
      }
    } else {
      navTo("s-store");
    }
  };
  var promoGetCardBadge = function(item) {
    const linked = (AppStore.getSlice((s) => s.promotions) || []).find((p) => p.linkedItemId === item.id && promoIsActive(p));
    if (linked) {
      const cfg = promoTypeConfig(linked.type);
      const tagLabel = linked.adminLabel || (linked.type === "custom" && linked.customTypeLabel ? linked.customTypeLabel : cfg.tagLabel);
      return { cls: linked.type, label: tagLabel };
    }
    const auto = promoGetAutoLabel(item);
    if (auto) return { cls: auto, label: { new: "NEW", hot: "\u{1F525} HOT", limited: "LIMITED", sale: "SALE", featured: "\u2B50" }[auto] || "PROMO" };
    return null;
  };
  var promoCountdownInterval = null;
  var promoStartCountdownTick = function() {
    if (promoCountdownInterval) clearInterval(promoCountdownInterval);
    promoCountdownInterval = setInterval(() => {
      const promotions = AppStore.getSlice((s) => s.promotions) || [];
      document.querySelectorAll(".promo-countdown").forEach((el) => {
        const slide = el.closest(".promo-slide");
        if (!slide) return;
        const id = slide.id?.replace("promo-slide-", "");
        const p = promotions.find((x) => x.id === id);
        if (!p?.endDate) return;
        const str = promoCountdownStr(p.endDate);
        if (str) {
          el.textContent = str;
          el.classList.toggle("urgent", new Date(p.endDate) - /* @__PURE__ */ new Date() < 36e5);
        } else {
          el.remove();
        }
      });
    }, 6e4);
  };
  var renderAdminPromotions = function() {
    const promos = AppStore.getSlice((s) => s.promotions) || [];
    const analytics = AppStore.getSlice((s) => s.promoAnalytics) || {};
    const activeCount = promos.filter((p) => promoIsActive(p)).length;
    const totalViews = Object.values(analytics).reduce((s, a) => s + (a.views || 0), 0);
    const totalClicks = Object.values(analytics).reduce((s, a) => s + (a.clicks || 0), 0);
    const totalPurchases = Object.values(analytics).reduce((s, a) => s + (a.purchases || 0), 0);
    let mostClicked = null, maxClicks = 0;
    Object.entries(analytics).forEach(([id, a]) => {
      if ((a.clicks || 0) > maxClicks) {
        maxClicks = a.clicks;
        mostClicked = promos.find((p) => p.id === id);
      }
    });
    let mostPurchased = null, maxPurchases = 0;
    Object.entries(analytics).forEach(([id, a]) => {
      if ((a.purchases || 0) > maxPurchases) {
        maxPurchases = a.purchases;
        mostPurchased = promos.find((p) => p.id === id);
      }
    });
    document.getElementById("a-promotions").innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">\u{1F4E3} Store Promotions</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${promos.length} total \xB7 ${activeCount} currently live</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="promoAdminPreviewStore()">\u{1F441} Preview Carousel</button>
      <button class="btn btn-primary" onclick="promoAdminOpenForm()">\uFF0B Create Promotion</button>
    </div>
  </div>

  <div class="promo-analytics-grid" style="margin-bottom:24px">
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--primary)">${activeCount}</div><div class="promo-stat-lbl">Active Promos</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--secondary)">${totalViews.toLocaleString()}</div><div class="promo-stat-lbl">Banner Views</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--tertiary)">${totalClicks.toLocaleString()}</div><div class="promo-stat-lbl">Banner Clicks</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:#4edea3">${totalPurchases.toLocaleString()}</div><div class="promo-stat-lbl">Promo Purchases</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:#f97316">${totalViews ? Math.round(totalClicks / totalViews * 100) : 0}%</div><div class="promo-stat-lbl">Click-Through Rate</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--error)">${totalClicks ? Math.round(totalPurchases / totalClicks * 100) : 0}%</div><div class="promo-stat-lbl">Conversion Rate</div></div>
  </div>

  ${mostClicked || mostPurchased ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">
    ${mostClicked ? `<div class="glass-card" style="padding:14px"><div style="font-size:11px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">\u{1F3C6} Most Clicked</div><div style="font-size:14px;font-weight:800;color:var(--on-surface)">${_esc(mostClicked.title)}</div><div style="font-size:12px;color:var(--tertiary);margin-top:4px">${maxClicks} clicks</div></div>` : ""}
    ${mostPurchased ? `<div class="glass-card" style="padding:14px"><div style="font-size:11px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">\u{1F4B0} Most Purchased</div><div style="font-size:14px;font-weight:800;color:var(--on-surface)">${_esc(mostPurchased.title)}</div><div style="font-size:12px;color:var(--secondary);margin-top:4px">${maxPurchases} purchases</div></div>` : ""}
  </div>` : ""}

  <div class="section-header"><span class="material-symbols-outlined">campaign</span><h2>All Promotions</h2><span class="badge-pill bp-primary">${promos.length}</span></div>

  ${!promos.length ? `
  <div style="text-align:center;padding:72px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px">
    <div style="font-size:56px;margin-bottom:14px">\u{1F4E3}</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:6px">No promotions yet</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px">Create your first promotion to transform the store banner.</div>
    <button class="btn btn-primary" onclick="promoAdminOpenForm()">\uFF0B Create First Promotion</button>
  </div>` : [...promos].sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((p) => {
      const cfg = promoTypeConfig(p.type);
      const isLive = promoIsActive(p);
      const a = analytics[p.id] || { views: 0, clicks: 0, purchases: 0 };
      const item = p.linkedItemId ? (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === p.linkedItemId) : null;
      const ctr = a.views ? Math.round(a.clicks / a.views * 100) : 0;
      const conv = a.clicks ? Math.round(a.purchases / a.clicks * 100) : 0;
      const tagLabel = p.adminLabel || (p.type === "custom" && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
      const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
      return `<div class="promo-admin-card">
      <div class="promo-admin-header">
        <div class="promo-admin-preview" style="font-size:28px">${p.image || item?.emoji || "\u{1F4E3}"}</div>
        <div class="promo-admin-info">
          <div class="promo-admin-title">${_esc(p.title)}</div>
          <div class="promo-admin-meta">
            <span class="promo-type-pill type-${p.type}" style="background:${cfg.btnColor}22;color:${cfg.btnColor};border:1px solid ${cfg.btnColor}44">${cfg.label}</span>
            <span class="badge-pill ${isLive ? "bp-green" : "bp-gray"}">${isLive ? "\u25CF LIVE" : "\u25CB Inactive"}</span>
            ${p.priority > 0 ? `<span class="badge-pill bp-gold">Priority ${p.priority}</span>` : ""}
            ${item ? `<span class="badge-pill bp-primary">\u{1F517} ${_esc(item.name)}</span>` : ""}
            ${countdown ? `<span style="font-size:11px;color:#fca5a5;font-weight:700">${countdown}</span>` : ""}
          </div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--text-muted)">
            <span>\u{1F441} ${a.views} views</span><span>\u{1F446} ${a.clicks} clicks</span>
            <span>\u{1F6D2} ${a.purchases} purchases</span><span>CTR: ${ctr}%</span><span>Conv: ${conv}%</span>
          </div>
          ${p.startDate || p.endDate ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${p.startDate ? "From " + new Date(p.startDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : ""}${p.endDate ? " \u2192 " + new Date(p.endDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : ""}</div>` : ""}
        </div>
        <div class="promo-admin-actions">
          <button class="btn btn-ghost btn-xs"                        onclick="promoAdminPreview('${p.id}')" title="Preview">\u{1F441}</button>
          <button class="btn btn-ghost btn-xs"                        onclick="promoAdminOpenForm('${p.id}')" title="Edit">\u270F\uFE0F</button>
          <button class="btn ${isLive ? "btn-success" : "btn-ghost"} btn-xs" onclick="promoAdminToggle('${p.id}')" title="${isLive ? "Disable" : "Enable"}">${isLive ? "\u2713 Live" : "\u25CB Off"}</button>
          <button class="btn btn-danger btn-xs"                       onclick="promoAdminDelete('${p.id}')" title="Delete">\u{1F5D1}</button>
        </div>
      </div>
    </div>`;
    }).join("")}`;
  };
  var promoAdminOpenForm = function(editId = null) {
    const p = editId ? (AppStore.getSlice((s) => s.promotions) || []).find((x) => x.id === editId) : null;
    const isEdit = !!p;
    const storeOpts = (AppStore.getSlice((s) => s.store) || []).map((i) => `<option value="${i.id}" ${p?.linkedItemId === i.id ? "selected" : ""}>${i.emoji} ${_esc(i.name)} (${i.cost} coins)</option>`).join("");
    const typesHTML = PROMO_TYPES.map((t) => `<option value="${t.value}" ${(p?.type || "featured") === t.value ? "selected" : ""}>${t.label}</option>`).join("");
    showModal(`
  <div class="modal-h2">${isEdit ? "\u270F\uFE0F Edit Promotion" : "\u{1F4E3} Create Promotion"}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Promotion Title *</label><input type="text" id="prf-title" value="${_esc(p?.title || "")}" placeholder="e.g. Mystery Box Flash Sale!" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Subtitle / Description</label><input type="text" id="prf-sub" value="${_esc(p?.subtitle || "")}" placeholder="Short call-to-action text..." style="width:100%"></div>
    <div class="form-group"><label class="form-label">Promotion Type</label><select id="prf-type" style="width:100%" onchange="promoFormTypeChange()">${typesHTML}</select></div>
    <div class="form-group"><label class="form-label">Display Emoji / Image</label><input type="text" id="prf-image" value="${_esc(p?.image || "")}" placeholder="\u{1F381} (emoji for banner)" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1" id="prf-custom-label-wrap" style="display:${p?.type === "custom" ? "block" : "none"}"><label class="form-label">Custom Tag Label</label><input type="text" id="prf-custom-label" value="${_esc(p?.customTypeLabel || "")}" placeholder="e.g. BUNDLE DEAL" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Admin Override Label</label><input type="text" id="prf-admin-label" value="${_esc(p?.adminLabel || "")}" placeholder="Leave blank to use type default" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Link to Store Item (optional)</label><select id="prf-item" style="width:100%"><option value="">\u2014 No linked item \u2014</option>${storeOpts}</select></div>
    <div class="form-group"><label class="form-label">Start Date</label><input type="date" id="prf-start" value="${p?.startDate ? p.startDate.slice(0, 10) : ""}" style="width:100%"></div>
    <div class="form-group"><label class="form-label">End Date</label><input type="date" id="prf-end" value="${p?.endDate ? p.endDate.slice(0, 10) : ""}" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Priority (higher = first)</label><input type="number" id="prf-priority" value="${p?.priority || 0}" min="0" max="100" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Rotation Interval (seconds)</label><input type="number" id="prf-interval" value="${p?.rotationInterval || 6}" min="2" max="60" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1;display:flex;align-items:center;gap:10px"><input type="checkbox" id="prf-active" ${p?.active !== false ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--primary-dark)"><label for="prf-active" style="font-size:13px;font-weight:600;color:var(--on-surface);cursor:pointer">Active (show in store)</label></div>
  </div>
  <div style="display:flex;gap:10px;margin-top:16px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    ${isEdit ? `<button class="btn btn-ghost btn-sm" onclick="promoAdminSaveForm('${p.id}',true)" style="flex:0 0 auto">\u{1F441} Save & Preview</button>` : ""}
    <button class="btn btn-primary" style="flex:1" onclick="promoAdminSaveForm('${editId || ""}')">${isEdit ? "\u{1F4BE} Save Changes" : "\u{1F4E3} Create Promotion"}</button>
  </div>`, "lg");
  };
  var promoFormTypeChange = function() {
    const type = document.getElementById("prf-type")?.value;
    const wrap = document.getElementById("prf-custom-label-wrap");
    if (wrap) wrap.style.display = type === "custom" ? "block" : "none";
  };
  var promoAdminSaveForm = function(editId = "", andPreview = false) {
    const title = (document.getElementById("prf-title")?.value || "").trim();
    if (!title) {
      toast("\u274C Title is required", "#ffb4ab");
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const obj = {
      id: editId || uid(),
      title,
      subtitle: (document.getElementById("prf-sub")?.value || "").trim(),
      type: document.getElementById("prf-type")?.value || "featured",
      image: (document.getElementById("prf-image")?.value || "").trim(),
      adminLabel: (document.getElementById("prf-admin-label")?.value || "").trim(),
      customTypeLabel: (document.getElementById("prf-custom-label")?.value || "").trim(),
      linkedItemId: document.getElementById("prf-item")?.value || "",
      startDate: document.getElementById("prf-start")?.value || "",
      endDate: document.getElementById("prf-end")?.value || "",
      priority: parseInt(document.getElementById("prf-priority")?.value) || 0,
      rotationInterval: parseInt(document.getElementById("prf-interval")?.value) || 6,
      active: document.getElementById("prf-active")?.checked !== false,
      createdAt: editId ? (AppStore.getSlice((s) => s.promotions) || []).find((p) => p.id === editId)?.createdAt || now : now
    };
    AppStore.updateState((draft) => {
      if (!Array.isArray(draft.promotions)) draft.promotions = [];
      if (editId) {
        const idx = draft.promotions.findIndex((p) => p.id === editId);
        if (idx >= 0) draft.promotions[idx] = obj;
        else draft.promotions.push(obj);
      } else {
        draft.promotions.push(obj);
      }
    }, { type: editId ? "shop:promo-updated" : "shop:promo-created", payload: { id: obj.id } });
    toast(editId ? "\u2705 Promotion updated!" : "\u{1F4E3} Promotion created!");
    closeModalForce();
    renderAdminPromotions();
    if (andPreview) promoAdminPreview(obj.id);
  };
  var promoAdminToggle = function(id) {
    const existing = (AppStore.getSlice((s) => s.promotions) || []).find((p) => p.id === id);
    if (!existing) return;
    let newActive = null;
    AppStore.updateState((draft) => {
      const idx = (draft.promotions || []).findIndex((p) => p.id === id);
      if (idx < 0) return;
      draft.promotions[idx].active = !draft.promotions[idx].active;
      newActive = draft.promotions[idx].active;
    }, { type: "shop:promo-toggled", payload: { id } });
    toast(newActive ? "\u2705 Promotion activated!" : "\u23F8 Promotion disabled.");
    renderAdminPromotions();
  };
  var promoAdminDelete = function(id) {
    const p = (AppStore.getSlice((s) => s.promotions) || []).find((x) => x.id === id);
    if (!p) return;
    showModal(`<div style="text-align:center;padding:10px">
    <div style="font-size:40px;margin-bottom:12px">\u{1F5D1}\uFE0F</div>
    <div class="modal-h2" style="text-align:center">Delete Promotion?</div>
    <div style="color:var(--text-muted);margin-bottom:20px;font-size:13px">Remove "${_esc(p.title)}"? Analytics data will also be removed.</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1" onclick="promoAdminConfirmDelete('${id}')">Delete</button>
    </div>
  </div>`, "sm");
  };
  var promoAdminConfirmDelete = function(id) {
    AppStore.updateState((draft) => {
      draft.promotions = (draft.promotions || []).filter((p) => p.id !== id);
      if (draft.promoAnalytics) delete draft.promoAnalytics[id];
    }, { type: "shop:promo-deleted", payload: { id } });
    closeModalForce();
    toast("\u{1F5D1} Promotion deleted.", "#ff8080");
    renderAdminPromotions();
  };
  var promoAdminPreview = function(id) {
    const p = (AppStore.getSlice((s) => s.promotions) || []).find((x) => x.id === id);
    if (!p) return;
    const cfg = promoTypeConfig(p.type);
    const item = p.linkedItemId ? (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === p.linkedItemId) : null;
    const emoji = p.image || item?.emoji || "\u{1F4E3}";
    const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
    const tagLabel = p.adminLabel || (p.type === "custom" && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
    const price = item ? item.cost : null;
    const isLive = promoIsActive(p);
    showModal(`<div>
    <div class="modal-h2">\u{1F441} Banner Preview \u2014 "${_esc(p.title)}"</div>
    <div class="promo-preview-wrap">
      <div class="promo-preview-banner promo-slide type-${p.type}" style="opacity:1;transform:none;position:relative;pointer-events:none">
        <div class="promo-slide-bg"></div>
        <div class="promo-slide-content" style="cursor:default">
          <div class="promo-slide-inner">
            ${countdown ? `<div class="promo-countdown">${countdown}</div>` : ""}
            <span class="promo-tag type-${p.type}">${tagLabel}</span>
            <div class="promo-title">${_esc(p.title)}</div>
            <div class="promo-sub">${_esc(p.subtitle || "")}</div>
            <div class="promo-cta">${price !== null ? `<div class="promo-price"><span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">monetization_on</span>${price}</div>` : ""}<button class="promo-btn">${item ? "Redeem" : "View \u2192"}</button></div>
          </div>
          <div class="promo-slide-emoji">${emoji}</div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;margin-bottom:16px">
      <div><span style="color:var(--text-muted)">Type:</span> <strong>${cfg.label}</strong></div>
      <div><span style="color:var(--text-muted)">Status:</span> <strong style="color:${isLive ? "#4edea3" : "#ffb4ab"}">${isLive ? "\u25CF Live" : "\u25CB Inactive"}</strong></div>
      <div><span style="color:var(--text-muted)">Priority:</span> <strong>${p.priority || 0}</strong></div>
      <div><span style="color:var(--text-muted)">Rotation:</span> <strong>${p.rotationInterval || 6}s</strong></div>
      ${item ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Linked Item:</span> <strong>${item.emoji} ${_esc(item.name)} \u2014 \u{1FA99}${item.cost}</strong></div>` : ""}
      ${p.startDate || p.endDate ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Schedule:</span> <strong>${p.startDate || "Now"} \u2192 ${p.endDate || "No end"}</strong></div>` : ""}
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalForce();promoAdminOpenForm('${id}')">\u270F\uFE0F Edit</button>
    </div>
  </div>`, "md");
  };
  var promoAdminPreviewStore = function() {
    const active = promoGetActive();
    if (!active.length) {
      toast("No active promotions to preview yet.", "#ffb95f");
      return;
    }
    const slidesHTML = active.map((p) => promoBuildSlideHTML(p)).join("");
    showModal(`<div>
    <div class="modal-h2">\u{1F3A0} Carousel Preview (${active.length} active promo${active.length !== 1 ? "s" : ""})</div>
    <div style="position:relative;overflow:hidden;border-radius:14px;height:180px;margin-bottom:16px;border:1px solid var(--border)">
      ${active[0] ? promoBuildSlideHTML(active[0]) : ""}
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;text-align:center">${active.length > 1 ? `Showing first of ${active.length} slides` : "Single slide"} \xB7 Students see this in the Armory</div>
    <button class="btn btn-ghost btn-block" onclick="closeModalForce()">Close</button>
  </div>`, "md");
  };
  console.log("[EduQuest] shop/promotions.js loaded \u2014 PROMO_TYPES, promo* helpers, carousel, renderAdminPromotions registered.");

  // build/test-helpers/shop_promotions-combined-entry.js
  window.AppStore = AppStore;
  window.toast = toast;
  window.showModal = showModal;
  window.closeModalForce = closeModalForce;
  window._esc = _esc;
  window.uid = uid;
  Object.keys(shop_promotions_exports).forEach((k) => {
    window[k] = shop_promotions_exports[k];
  });
})();
