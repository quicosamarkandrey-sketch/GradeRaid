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

  // src/modules/shop/shop_index.js
  (function injectShopCSS() {
    if (document.getElementById("shop-module-css")) return;
    const style = document.createElement("style");
    style.id = "shop-module-css";
    style.textContent = `
/* \u2500\u2500 Store grid & cards \u2500\u2500 */
.store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;margin-bottom:32px}
.store-card{
  position:relative;border-radius:18px;padding:22px 18px 16px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;overflow:hidden;
  display:flex;flex-direction:column;
}
.store-card:hover:not(.out-of-stock){transform:translateY(-4px);box-shadow:0 14px 44px rgba(0,0,0,.5);border-color:rgba(208,188,255,.25)}
.store-card.out-of-stock{opacity:.6}
.store-emoji{font-size:44px;margin-bottom:10px;text-align:center;line-height:1;display:block;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.store-rarity{text-align:center;margin-bottom:8px}
.store-name{font-family:var(--fh);font-size:15px;font-weight:900;color:var(--on-surface);text-align:center;margin-bottom:5px;line-height:1.2}
.store-desc{font-size:11px;color:var(--text-muted);text-align:center;line-height:1.5;margin-bottom:8px;flex:1}
.store-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;gap:8px}
.store-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:var(--tertiary)}
.store-price .material-symbols-outlined{font-size:18px;font-variation-settings:'FILL' 1;color:var(--tertiary)}
.store-redeem-btn{background:linear-gradient(135deg,var(--primary-dark),#7c3aed);color:#fff;border:none;border-radius:10px;padding:7px 12px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s;white-space:nowrap}
.store-redeem-btn:hover:not([disabled]){transform:scale(1.05);box-shadow:0 4px 16px rgba(139,92,246,.4)}
.store-redeem-btn[disabled]{background:rgba(255,255,255,.08);cursor:not-allowed}

/* \u2500\u2500 Category tabs \u2500\u2500 */
.cat-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.cat-tab{padding:8px 18px;border-radius:30px;font-size:12px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;transition:all .18s;font-family:var(--fb)}
.cat-tab:hover{border-color:rgba(208,188,255,.3);color:var(--on-surface)}
.cat-tab.active{background:rgba(139,92,246,.18);border-color:rgba(208,188,255,.4);color:var(--primary)}

/* \u2500\u2500 Rarity pills \u2500\u2500 */
.rarity-pill{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:6px;display:inline-block}
.rarity-legendary{background:rgba(255,215,0,.16);color:#ffd700;border:1px solid rgba(255,215,0,.3)}
.rarity-epic{background:rgba(208,188,255,.14);color:#d0bcff;border:1px solid rgba(208,188,255,.3)}
.rarity-rare{background:rgba(144,180,255,.14);color:#93c5fd;border:1px solid rgba(144,180,255,.25)}
.rarity-common{background:rgba(203,195,215,.1);color:rgba(203,195,215,.7);border:1px solid rgba(203,195,215,.15)}

/* \u2500\u2500 Cart FAB \u2500\u2500 */
.cart-fab{
  position:fixed;bottom:28px;right:28px;z-index:900;
  background:linear-gradient(135deg,#8b5cf6,#EC4899);
  color:#fff;border:none;border-radius:30px;
  padding:14px 22px;font-size:14px;font-weight:800;
  cursor:pointer;font-family:var(--fh);
  box-shadow:0 8px 32px rgba(139,92,246,.5);
  display:flex;align-items:center;gap:10px;
  transition:all .25s;animation:fadeIn .25s ease;
}
.cart-fab:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(139,92,246,.6)}
.cart-count{background:rgba(255,255,255,.2);border-radius:20px;padding:2px 9px;font-size:12px;font-weight:900}
.cart-item-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.cart-qty-ctrl{display:flex;align-items:center;gap:5px}
.cart-qty-btn{background:rgba(255,255,255,.08);border:1px solid var(--border2);border-radius:7px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;color:var(--on-surface);font-weight:700;transition:all .15s}
.cart-qty-btn:hover{background:rgba(208,188,255,.15);border-color:rgba(208,188,255,.35)}

/* \u2500\u2500 Store banner / promo carousel \u2500\u2500 */
.store-banner,.promo-empty-banner{width:100%;height:168px;border-radius:18px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(208,188,255,.15);box-shadow:0 8px 32px rgba(0,0,0,.3);position:relative;flex-shrink:0}
.promo-carousel{width:100%;height:100%;position:relative}
.promo-slide{position:absolute;inset:0;opacity:0;transition:opacity .5s ease;border-radius:inherit;overflow:hidden}
.promo-slide.active{opacity:1;z-index:1}
.promo-slide-bg{position:absolute;inset:0;pointer-events:none}
.promo-slide.type-new .promo-slide-bg{background:linear-gradient(135deg,#0f0a2e 0%,#1e1060 50%,#0a1a3e 100%)}
.promo-slide.type-hot .promo-slide-bg{background:linear-gradient(135deg,#1a0a00 0%,#3d1500 50%,#1a0800 100%)}
.promo-slide.type-sale .promo-slide-bg{background:linear-gradient(135deg,#1a0008 0%,#3d0020 50%,#0a0018 100%)}
.promo-slide.type-limited .promo-slide-bg{background:linear-gradient(135deg,#1a1000 0%,#3d2800 50%,#0a1200 100%)}
.promo-slide.type-featured .promo-slide-bg{background:linear-gradient(135deg,#001a10 0%,#003d28 50%,#001a0a 100%)}
.promo-slide.type-event .promo-slide-bg{background:linear-gradient(135deg,#1a0020 0%,#3d0060 50%,#0a0830 100%)}
.promo-slide.type-seasonal .promo-slide-bg{background:linear-gradient(135deg,#0a1a00 0%,#1e3d00 50%,#001a0a 100%)}
.promo-slide.type-custom .promo-slide-bg{background:linear-gradient(135deg,#0a0a1a 0%,#1a1a3d 50%,#0a0a28 100%)}
.promo-slide-content{position:relative;z-index:2;display:flex;align-items:center;height:100%;padding:20px 28px;cursor:pointer}
.promo-slide-inner{flex:1;min-width:0}
.promo-slide-emoji{font-size:72px;line-height:1;flex-shrink:0;margin-left:20px;filter:drop-shadow(0 4px 20px rgba(255,255,255,.15))}
.promo-countdown{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:5px;background:rgba(255,255,255,.08);display:inline-block;padding:3px 10px;border-radius:6px}
.promo-countdown.urgent{color:#fca5a5;background:rgba(239,68,68,.15);animation:pulse 1s infinite}
.promo-tag{font-size:9px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;padding:3px 10px;border-radius:6px;display:inline-block;margin-bottom:8px}
.promo-tag.type-new{background:rgba(139,92,246,.2);color:#d0bcff;border:1px solid rgba(139,92,246,.4)}
.promo-tag.type-hot{background:rgba(249,115,22,.2);color:#fdba74;border:1px solid rgba(249,115,22,.4)}
.promo-tag.type-sale{background:rgba(239,68,68,.2);color:#fca5a5;border:1px solid rgba(239,68,68,.4)}
.promo-tag.type-limited{background:rgba(255,185,95,.2);color:#ffb95f;border:1px solid rgba(255,185,95,.4)}
.promo-tag.type-featured{background:rgba(78,222,163,.18);color:#4edea3;border:1px solid rgba(78,222,163,.38)}
.promo-tag.type-event{background:rgba(236,72,153,.2);color:#f9a8d4;border:1px solid rgba(236,72,153,.4)}
.promo-tag.type-seasonal{background:rgba(139,92,246,.18);color:#c4b5fd;border:1px solid rgba(139,92,246,.4)}
.promo-tag.type-custom{background:rgba(96,165,250,.15);color:#93c5fd;border:1px solid rgba(96,165,250,.35)}
.promo-title{font-family:var(--fh);font-size:20px;font-weight:900;color:#fff;line-height:1.2;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.promo-sub{font-size:12px;color:rgba(255,255,255,.65);line-height:1.4;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.promo-cta{display:flex;align-items:center;gap:10px}
.promo-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:#ffd700}
.promo-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 14px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s;backdrop-filter:blur(8px)}
.promo-btn:hover{background:rgba(255,255,255,.22);transform:scale(1.04)}
.promo-carousel-controls{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;z-index:10}
.promo-nav-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s;backdrop-filter:blur(4px)}
.promo-nav-btn:hover{background:rgba(255,255,255,.2)}
.promo-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer;transition:all .25s}
.promo-dot.active{background:#fff;width:18px;border-radius:4px}
.store-banner-inner{max-width:500px}
.store-banner-tag{font-size:9px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#4edea3;display:block;margin-bottom:6px}
.store-banner-title{font-family:var(--fh);font-size:22px;font-weight:900;color:#fff;margin-bottom:5px}
.store-banner-sub{font-size:12px;color:rgba(255,255,255,.65);margin-bottom:10px;line-height:1.4}
.store-banner-cta{display:flex;align-items:center;gap:10px}
.store-banner-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:#ffd700}
.store-banner-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 16px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb)}

/* \u2500\u2500 Inventory \u2500\u2500 */
.inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;margin-bottom:24px}
.inv-card{position:relative;border-radius:16px;padding:18px;background:rgba(35,31,56,.85);border:1px solid var(--border);backdrop-filter:blur(12px);transition:all .3s;display:flex;flex-direction:column;align-items:center}
.inv-card:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(0,0,0,.45);border-color:rgba(208,188,255,.2)}
.inv-card-used{opacity:.6}
.inv-card-top{position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center}
.inv-qty-badge{background:rgba(139,92,246,.18);border:1px solid rgba(208,188,255,.25);border-radius:8px;padding:2px 8px;font-size:10px;font-weight:900;color:var(--primary);font-family:var(--fh)}
.inv-qty-multi{background:rgba(78,222,163,.15);border-color:rgba(78,222,163,.3);color:var(--secondary)}
.inv-pending-dot{width:10px;height:10px;border-radius:50%;background:var(--tertiary);box-shadow:0 0 8px rgba(255,185,95,.6);animation:pulse 1.5s infinite}
.inv-used-badge{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#ffb4ab;background:rgba(255,180,171,.1);border:1px solid rgba(255,180,171,.25);border-radius:6px;padding:2px 7px}
.inv-emoji{font-size:44px;line-height:1;margin:24px 0 8px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.inv-rarity{margin-bottom:8px}
.inv-name{font-family:var(--fh);font-size:13px;font-weight:900;color:var(--on-surface);text-align:center;margin-bottom:5px;line-height:1.2}
.inv-cat-pill{font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid;margin-bottom:6px}
.inv-date,.inv-source{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);margin-bottom:3px}
.inv-code-btn{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;padding:7px;margin:8px 0 4px;background:rgba(78,222,163,.08);border:1px solid rgba(78,222,163,.22);border-radius:9px;color:var(--secondary);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-code-btn:hover{background:rgba(78,222,163,.15);border-color:rgba(78,222,163,.4)}
.inv-card-actions{display:flex;gap:6px;margin-top:auto;padding-top:10px;width:100%}
.inv-use-btn{flex:1;padding:7px 10px;background:linear-gradient(135deg,var(--primary-dark),#7c3aed);color:#fff;border:none;border-radius:9px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-use-btn:hover{transform:scale(1.04)}
.inv-detail-btn{flex:1;padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid var(--border2);color:var(--text-muted);border-radius:9px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-detail-btn:hover{background:rgba(255,255,255,.1);color:var(--on-surface)}
.inv-empty{text-align:center;padding:80px 20px;background:rgba(35,31,56,.7);border:1px dashed var(--border);border-radius:16px}
.inv-toolbar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-start}
.inv-search-wrap{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:12px;padding:9px 14px}
.inv-filter-row{display:flex;gap:8px;flex-wrap:wrap}
.inv-hist-list{display:flex;flex-direction:column;gap:8px}
.inv-hist-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;transition:all .2s}
.inv-hist-row:hover{border-color:rgba(208,188,255,.2)}
.inv-hist-emoji{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(255,255,255,.04);border:1px solid var(--border);flex-shrink:0}
.inv-hist-info{flex:1;min-width:0}
.inv-hist-name{font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.inv-hist-meta{font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.inv-hist-cost{display:flex;align-items:center;gap:4px;flex-shrink:0}
.inv-tab-row{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px}
.inv-tab{display:flex;align-items:center;gap:7px;padding:11px 20px;font-size:13px;font-weight:700;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--fb)}
.inv-tab:hover{color:var(--on-surface)}
.inv-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.inv-tab .material-symbols-outlined{font-size:16px}

/* \u2500\u2500 Promotions admin \u2500\u2500 */
.promo-analytics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.promo-stat-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}
.promo-stat-val{font-family:var(--fh);font-size:24px;font-weight:900;line-height:1;margin-bottom:4px}
.promo-stat-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700}
.promo-admin-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden;transition:all .2s}
.promo-admin-card:hover{border-color:rgba(208,188,255,.25)}
.promo-admin-header{display:flex;align-items:flex-start;gap:14px;padding:16px}
.promo-admin-preview{width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.promo-admin-info{flex:1;min-width:0}
.promo-admin-title{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:6px}
.promo-admin-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.promo-admin-actions{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap}
.promo-type-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px}
.promo-preview-wrap{border-radius:12px;overflow:hidden;height:168px;margin-bottom:16px;position:relative;border:1px solid var(--border)}
.promo-preview-banner{position:absolute;inset:0}

/* \u2500\u2500 Stock edit \u2500\u2500 */
.stock-cell{display:flex;align-items:center;justify-content:flex-end}
.stock-val{cursor:pointer;font-family:var(--fh);font-weight:800;padding:4px 10px;border-radius:8px;border:1px solid transparent;transition:all .15s}
.stock-val:hover{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.25)}
.stock-edit-wrap{display:flex;align-items:center;gap:6px}
.stock-edit-input{width:64px;background:rgba(35,31,56,.9);border:1px solid rgba(208,188,255,.4);border-radius:8px;padding:5px 10px;font-family:var(--fh);font-weight:800;font-size:14px;color:var(--on-surface);text-align:center;outline:none}
.stock-edit-input:focus{border-color:rgba(208,188,255,.7);box-shadow:0 0 0 3px rgba(208,188,255,.1)}
.stock-save-btn{background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.35);border-radius:8px;color:var(--secondary);padding:5px 10px;cursor:pointer;font-weight:800;font-size:14px;transition:all .15s}
.stock-save-btn:hover{background:rgba(78,222,163,.25)}
`;
    document.head.appendChild(style);
  })();
  AppStore.ready.then(function shopMigrateDB() {
    const current = AppStore.getSlice((s) => ({ store: s.store, orders: s.orders, redemptions: s.redemptions, inventory: s.inventory, promotions: s.promotions, promoAnalytics: s.promoAnalytics }));
    const missing2 = ["store", "orders", "redemptions", "inventory", "promotions", "promoAnalytics"].filter((k) => !current || !current[k]);
    if (!missing2.length) return;
    AppStore.updateState((draft) => {
      if (!draft.store) draft.store = [];
      if (!draft.orders) draft.orders = [];
      if (!draft.redemptions) draft.redemptions = [];
      if (!draft.inventory) draft.inventory = {};
      if (!draft.promotions) draft.promotions = [];
      if (!draft.promoAnalytics) draft.promoAnalytics = {};
    }, { type: "shop:libraries-initialized", payload: { keys: missing2 } });
  });
  var EXPECTED = [
    // store.js
    "getItemRarity",
    "renderStudentStore",
    "cartAdd",
    "cartRemove",
    "cartSetQty",
    "cartClear",
    "cartOpenModal",
    "cartCheckout",
    "posGenCode",
    "posShowClaimCode",
    "buyItem",
    "confirmBuy",
    // inventory.js
    "INV_CAT_LABELS",
    "INV_CAT_ICONS",
    "INV_CAT_COLORS",
    "renderInventory",
    "invSwitchTab",
    "invFilter",
    "invHistFilter",
    "invUseItem",
    "invConfirmUse",
    "invViewDetail",
    "invShowCodes",
    "invUpdateSidebarBadge",
    // orders.js
    "ordStatusPill",
    "ordLabel",
    "renderStudentOrders",
    "ordSwitchTab",
    "ordCancelPrompt",
    "ordExecuteCancel",
    "ordUpdateSidebarBadge",
    // admin-store.js
    "renderAdminStore",
    "renderProductRows",
    "stockStartEdit",
    "stockSave",
    "openAddProduct",
    "openEditProduct",
    "doAddProduct",
    "doEditProduct",
    "deleteProduct",
    "confirmDeleteProduct",
    // pos-terminal.js
    "renderPOS",
    "posSwitchTab",
    "posLookupCode",
    "posConfirmClaim",
    "posExecuteClaim",
    "posCancelOrderPrompt",
    "posExecuteCancel",
    "posFilterQueue",
    "posFilterHistory",
    // promotions.js
    "PROMO_TYPES",
    "promoTypeConfig",
    "promoIsActive",
    "promoGetActive",
    "promoRecordView",
    "promoRecordClick",
    "promoRecordPurchase",
    "promoGetAutoLabel",
    "promoCountdownStr",
    "promoRenderCarousel",
    "promoNav",
    "promoGoTo",
    "promoClickBanner",
    "promoGetCardBadge",
    "promoBuildSlideHTML",
    "promoStartCountdownTick",
    "renderAdminPromotions",
    "promoAdminOpenForm",
    "promoAdminSaveForm",
    "promoAdminToggle",
    "promoAdminDelete",
    "promoAdminConfirmDelete",
    "promoAdminPreview",
    "promoAdminPreviewStore",
    "promoFormTypeChange"
  ];
  var missing = EXPECTED.filter((name) => typeof window[name] !== "function" && typeof window[name] !== "object");
  if (missing.length) {
    console.error("[EduQuest] shop/index.js \u2014 MISSING exports:", missing);
  } else {
    console.log("[EduQuest] shop/index.js \u2014 All exports verified \u2705");
  }
  var MODULE_VERSION = "1.0.0";

  // build/bridges/shop_index.bridge.js
  window.__SHOP_MODULE_VERSION__ = MODULE_VERSION;

  // build/test-helpers/shop_index-combined-entry.js
  window.AppStore = AppStore;
})();
