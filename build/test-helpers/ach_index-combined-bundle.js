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

  // src/modules/achievements/ach_index.js
  (function injectAchievementsCSS() {
    if (document.getElementById("achievements-module-css")) return;
    const style = document.createElement("style");
    style.id = "achievements-module-css";
    style.textContent = `
/* \u2500\u2500 Sidebar badge \u2500\u2500 */
.ach-nav-badge{margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)}

/* \u2500\u2500 Stats bar \u2500\u2500 */
.ach-stats-bar{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-bottom:24px}
.ach-stat-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center;backdrop-filter:blur(10px)}
.ach-stat-val{font-family:var(--fh);font-size:26px;font-weight:900;line-height:1;margin-bottom:4px}
.ach-stat-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700}

/* \u2500\u2500 Filter bar \u2500\u2500 */
.ach-filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center}
.ach-filter-btn{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb);white-space:nowrap}
.ach-filter-btn:hover{border-color:rgba(208,188,255,.3);color:var(--on-surface)}
.ach-filter-btn.active{background:rgba(139,92,246,.18);border-color:rgba(208,188,255,.4);color:var(--primary)}
.ach-search-input{background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:12px;padding:8px 14px;color:var(--text);font-family:var(--fb);font-size:13px;outline:none;transition:border-color .18s}
.ach-search-input:focus{border-color:rgba(208,188,255,.4)}

/* \u2500\u2500 Badge grid & cards \u2500\u2500 */
.badges-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:32px}
.ach-badge-card{
  position:relative;border-radius:16px;padding:18px 14px 14px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;
  display:flex;flex-direction:column;align-items:center;text-align:center;
  overflow:hidden;
}
.ach-badge-card:hover:not(.ach-locked){transform:translateY(-3px);box-shadow:0 10px 36px rgba(0,0,0,.5)}
.ach-badge-card.ach-locked{opacity:.55;filter:grayscale(.5)}
.ach-badge-card.ach-unclaimed{animation:achUnclaimed 3s ease-in-out infinite}
@keyframes achUnclaimed{0%,100%{box-shadow:var(--ach-glow,0 0 0 rgba(0,0,0,0))}50%{box-shadow:var(--ach-glow,0 0 20px rgba(208,188,255,.3))}}
.ach-rarity-strip{position:absolute;top:0;left:0;right:0;height:3px;border-radius:16px 16px 0 0}
.ach-unclaimed-glow{position:absolute;top:0;left:0;right:0;height:60%;pointer-events:none}
.ach-badge-icon-wrap{font-size:44px;line-height:1;margin:12px 0 8px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.ach-badge-title{font-family:var(--fh);font-size:13px;font-weight:900;color:var(--on-surface);margin-bottom:4px;line-height:1.2}
.ach-rarity-tag{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:6px;display:inline-block;margin-bottom:6px}
.ach-badge-desc{font-size:11px;color:var(--text-muted);line-height:1.4;margin-bottom:8px;flex:1}
.ach-unlocked-stamp{font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--secondary);text-transform:uppercase;margin-bottom:6px;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.2);border-radius:6px;padding:3px 10px}
.ach-unclaimed-label{font-size:9px;font-weight:800;letter-spacing:.06em;color:#EC4899;text-transform:uppercase;margin-bottom:6px;background:rgba(236,72,153,.1);border:1px solid rgba(236,72,153,.3);border-radius:6px;padding:3px 10px;animation:achBadgePulse 2s ease-in-out infinite}
.ach-reward-chips{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-bottom:8px}
.ach-reward-chip{font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;border:1px solid;white-space:nowrap}
.ach-claim-btn{width:100%;padding:8px;margin-top:2px;border:none;border-radius:10px;color:#fff;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s}
.ach-claim-btn:hover{transform:scale(1.04);box-shadow:0 4px 16px rgba(139,92,246,.4)}

/* \u2500\u2500 Rarity classes \u2500\u2500 */
.ach-rarity-common{color:#9ca3af;border-color:rgba(156,163,175,0.25);background:rgba(156,163,175,0.08)}
.ach-rarity-uncommon{color:#4ade80;border-color:rgba(74,222,128,0.25);background:rgba(74,222,128,0.08)}
.ach-rarity-rare{color:#60a5fa;border-color:rgba(96,165,250,0.25);background:rgba(96,165,250,0.08)}
.ach-rarity-epic{color:#c084fc;border-color:rgba(192,132,252,0.25);background:rgba(192,132,252,0.08)}
.ach-rarity-legendary{color:#fbbf24;border-color:rgba(251,191,36,0.3);background:rgba(251,191,36,0.1)}
.ach-rarity-mythic{color:#f472b6;border-color:rgba(244,114,182,0.3);background:rgba(244,114,182,0.1)}

/* \u2500\u2500 Unlock popup \u2500\u2500 */
.ach-unlock-popup{
  position:fixed;bottom:24px;right:24px;z-index:9999;
  display:flex;align-items:center;gap:14px;
  background:rgba(26,24,44,0.97);
  border:1px solid rgba(208,188,255,.35);
  border-radius:16px;padding:16px 20px;
  box-shadow:0 8px 40px rgba(139,92,246,.3);
  max-width:340px;animation:achPopIn .4s ease;
  backdrop-filter:blur(16px);
}
.ach-popup-icon{font-size:36px;line-height:1;flex-shrink:0}
.ach-popup-title{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.ach-popup-name{font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface)}
.ach-popup-rewards{font-size:11px;margin-top:3px}
@keyframes achPopIn{from{opacity:0;transform:translateX(40px) scale(.9)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes achPopOut{to{opacity:0;transform:translateX(40px) scale(.9)}}
@keyframes achBadgePulse{0%,100%{opacity:1}50%{opacity:.6}}

/* \u2500\u2500 Admin table \u2500\u2500 */
.ach-admin-table{width:100%;border-collapse:collapse}
.ach-admin-table th{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);padding:12px 14px;border-bottom:1px solid var(--border)}
.ach-admin-table td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.03);vertical-align:middle}
.ach-admin-table tr:hover td{background:rgba(255,255,255,.02)}
.ach-toggle-btn{background:none;border:1px solid;border-radius:8px;padding:4px 10px;font-size:10px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .15s}
.ach-toggle-btn:hover{opacity:.8}
`;
    document.head.appendChild(style);
  })();
  AppStore.ready.then(function achMigrateDB() {
    const current = AppStore.getSlice((s) => ({ achievements: s.achievements, achievementUnlocks: s.achievementUnlocks, achievementCategories: s.achievementCategories }));
    const missing2 = ["achievements", "achievementUnlocks", "achievementCategories"].filter((k) => !current || !current[k]);
    if (!missing2.length) return;
    AppStore.updateState((draft) => {
      if (!draft.achievements) draft.achievements = [];
      if (!draft.achievementUnlocks) draft.achievementUnlocks = {};
      if (!draft.achievementCategories) {
        draft.achievementCategories = ["Quests", "Attendance", "Combat", "Social", "Milestones", "Hidden", "Special"];
      }
    }, { type: "achievements:libraries-initialized", payload: { keys: missing2 } });
  });
  function achClaimRewardFallback(achId) {
    console.warn("[EduQuest] achClaimReward called before student-page.js loaded for", achId);
  }
  if (typeof window.achClaimReward !== "function") {
    window.achClaimReward = achClaimRewardFallback;
  }
  var EXPECTED = [
    // engine.js
    "ACH_RARITY",
    "ACH_RARITIES",
    "ACH_TRIGGER_TYPES",
    "achRarityClass",
    "achBuildStats",
    "achCheckAndAward",
    "achGrantRewardsForClaim",
    "achUpdateSidebarBadge",
    "achShowUnlockPopup",
    // student-page.js
    "renderBadges",
    "achClaimReward",
    // admin-page.js
    "renderAdminAchievements",
    "achAdminOpenForm",
    "achAdminUpdateTriggerHint",
    "achAdminSave",
    "achAdminToggle",
    "achAdminDelete",
    "achAdminDuplicate",
    "achAdminPreview",
    "achAdminGrantAchievement",
    "achAdminUpdateGrantPreview",
    "achAdminDoGrant",
    "achAdminManageCategories",
    "achAdminAddCat",
    "achAdminDeleteCat"
  ];
  var missing = EXPECTED.filter((name) => typeof window[name] !== "function" && typeof window[name] !== "object");
  if (missing.length) {
    console.error("[EduQuest] achievements/index.js \u2014 MISSING exports:", missing);
  } else {
    console.log("[EduQuest] achievements/index.js \u2014 All exports verified \u2705");
  }
  var MODULE_VERSION = "1.0.0";

  // build/bridges/ach_index.bridge.js
  window.__ACHIEVEMENTS_MODULE_VERSION__ = MODULE_VERSION;

  // build/test-helpers/ach_index-combined-entry.js
  window.AppStore = AppStore;
})();
