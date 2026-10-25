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

  // src/modules/shared/reward-presenter.js
  (function() {
    const style = document.createElement("style");
    style.textContent = `

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   UNIVERSAL REWARD PRESENTATION OVERLAY
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
#eq-reward-overlay {
  position:fixed;inset:0;z-index:8000;
  display:flex;align-items:center;justify-content:center;
  background:rgba(4,3,14,0.92);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  animation:eqrFadeIn .3s ease forwards;
  padding:20px;
}
@keyframes eqrFadeIn{from{opacity:0}to{opacity:1}}
@keyframes eqrFadeOut{from{opacity:1}to{opacity:0}}

.eqr-panel {
  background:rgba(22,18,40,0.98);
  border-radius:24px;
  border:1px solid rgba(255,255,255,0.1);
  width:100%;max-width:480px;
  max-height:92vh;
  position:relative;overflow:hidden;
  animation:eqrPanelIn .45s cubic-bezier(.17,.67,.34,1.3) forwards;
  box-shadow:0 0 60px rgba(139,92,246,0.2),0 40px 80px rgba(0,0,0,0.6);
}
.eqr-panel-scroll {
  max-height:88vh;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent;
}
@keyframes eqrPanelIn{from{transform:scale(.8) translateY(30px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}

/* Animated top strip */
.eqr-strip {
  height:4px;width:100%;
  background:linear-gradient(90deg,#8b5cf6,#EC4899,#ffb95f,#4edea3,#8b5cf6);
  background-size:200% 100%;
  animation:eqrStrip 2s linear infinite;
}
@keyframes eqrStrip{0%{background-position:0% 0}100%{background-position:200% 0}}

/* Canvas for particle effects */
.eqr-canvas {
  position:absolute;inset:0;width:100%;height:100%;
  pointer-events:none;z-index:0;border-radius:24px;overflow:hidden;
}

.eqr-body { position:relative;z-index:1;padding:32px; }

/* Source label */
.eqr-source-label {
  font-family:var(--fm);font-size:9px;letter-spacing:.18em;
  color:rgba(208,188,255,.5);text-transform:uppercase;
  text-align:center;margin-bottom:16px;
}

/* Icon area */
.eqr-icon-wrap {
  width:80px;height:80px;border-radius:20px;
  display:flex;align-items:center;justify-content:center;
  font-size:44px;margin:0 auto 18px;
  position:relative;
  animation:eqrIconBounce .6s cubic-bezier(.17,.67,.34,1.4) .2s both;
}
@keyframes eqrIconBounce{from{transform:scale(0) rotate(-15deg)}to{transform:scale(1) rotate(0)}}

.eqr-icon-ring {
  position:absolute;inset:-6px;border-radius:26px;
  border:2px solid;
  animation:eqrRingPulse 2s ease-in-out infinite;
}
@keyframes eqrRingPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.8;transform:scale(1.04)}}
.eqr-icon-ring2 {
  position:absolute;inset:-14px;border-radius:34px;
  border:1px solid;
  opacity:.3;
  animation:eqrRingPulse 2s ease-in-out .4s infinite;
}

/* Rarity badge */
.eqr-rarity-badge {
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 12px;border-radius:20px;
  font-family:var(--fm);font-size:9px;font-weight:700;letter-spacing:.1em;
  margin:0 auto 12px;
}

/* Title & subtitle */
.eqr-title {
  font-family:var(--fh);font-size:26px;font-weight:900;
  color:var(--on-surface);text-align:center;
  line-height:1.2;margin-bottom:6px;letter-spacing:-.5px;
}
.eqr-subtitle {
  font-size:13px;color:var(--text-muted);
  text-align:center;margin-bottom:24px;line-height:1.5;
}

/* Divider */
.eqr-divider {
  height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);
  margin-bottom:20px;
}

/* Rewards section */
.eqr-rewards-label {
  font-family:var(--fm);font-size:9px;letter-spacing:.14em;
  color:rgba(208,188,255,.5);text-align:center;margin-bottom:14px;
}
.eqr-rewards-grid {
  display:flex;gap:10px;justify-content:center;flex-wrap:wrap;
  margin-bottom:24px;
  padding:4px 2px;
}
.eqr-reward-card {
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:14px 16px;
  text-align:center;min-width:90px;flex:1;max-width:130px;
  animation:eqrCardIn .5s cubic-bezier(.17,.67,.34,1.3) both;
  position:relative;overflow:hidden;
}
.eqr-reward-card.eqr-reward-title {
  min-width:180px;max-width:280px;flex:0 0 auto;
  background:rgba(236,72,153,.08);
  border-color:rgba(236,72,153,.3);
}
.eqr-reward-card::after {
  content:'';position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(255,255,255,.03),transparent);
  pointer-events:none;
}
@keyframes eqrCardIn{from{transform:translateY(20px) scale(.8);opacity:0}to{transform:none;opacity:1}}
.eqr-reward-card:nth-child(1){animation-delay:.2s}
.eqr-reward-card:nth-child(2){animation-delay:.3s}
.eqr-reward-card:nth-child(3){animation-delay:.4s}
.eqr-reward-card:nth-child(4){animation-delay:.5s}
.eqr-reward-card:nth-child(5){animation-delay:.6s}

.eqr-reward-icon {font-size:28px;line-height:1;margin-bottom:8px;display:block}
.eqr-reward-amount {
  font-family:var(--fh);font-size:20px;font-weight:900;
  display:block;margin-bottom:3px;
}
.eqr-reward-label {
  font-size:9px;color:var(--text-muted);font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;
}

/* "Nothing to claim" state */
.eqr-no-rewards {
  text-align:center;padding:8px 0 16px;
  font-size:13px;color:var(--text-muted);
  animation:eqrCardIn .5s ease .2s both;
}

/* Claim button */
.eqr-claim-btn {
  width:100%;padding:14px;border-radius:14px;
  border:none;cursor:pointer;
  font-family:var(--fh);font-size:15px;font-weight:900;
  letter-spacing:.04em;color:#fff;
  transition:all .18s;position:relative;overflow:hidden;
  animation:eqrCardIn .4s ease .6s both;
}
.eqr-claim-btn::after {
  content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);
  transform:translateX(-100%);transition:transform .5s;
}
.eqr-claim-btn:hover::after{transform:translateX(100%)}
.eqr-claim-btn:hover{transform:translateY(-2px);box-shadow:var(--eqr-btn-glow)}
.eqr-claim-btn:active{transform:translateY(0)}

/* Confetti particle */
.eqr-confetti {
  position:absolute;width:8px;height:8px;border-radius:2px;
  pointer-events:none;z-index:2;
  animation:eqrConfettiFall linear both;
}
@keyframes eqrConfettiFall {
  0%{transform:translateY(-10px) rotate(0deg);opacity:1}
  100%{transform:translateY(600px) rotate(720deg);opacity:0}
}

/* Shine streak on panel */
.eqr-shine {
  position:absolute;top:0;left:-60%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent);
  transform:skewX(-20deg);pointer-events:none;z-index:2;
  animation:eqrShine 2.5s ease-in-out 0.8s both;
}
@keyframes eqrShine{0%{left:-60%}50%{left:130%}100%{left:130%}}`;
    document.head.appendChild(style);
  })();
  var EQR_RARITY_COLORS = {
    Common: { bg: "rgba(156,163,175,.12)", border: "rgba(156,163,175,.3)", strip: "#6b7280", glow: "rgba(156,163,175,.3)" },
    Uncommon: { bg: "rgba(74,222,128,.1)", border: "rgba(74,222,128,.3)", strip: "#22c55e", glow: "rgba(74,222,128,.35)" },
    Rare: { bg: "rgba(96,165,250,.1)", border: "rgba(96,165,250,.3)", strip: "#3b82f6", glow: "rgba(96,165,250,.4)" },
    Epic: { bg: "rgba(192,132,252,.1)", border: "rgba(192,132,252,.3)", strip: "#9333ea", glow: "rgba(192,132,252,.45)" },
    Legendary: { bg: "rgba(251,191,36,.1)", border: "rgba(251,191,36,.3)", strip: "#f59e0b", glow: "rgba(251,191,36,.5)" },
    Mythic: { bg: "rgba(244,114,182,.1)", border: "rgba(244,114,182,.3)", strip: "#ec4899", glow: "rgba(244,114,182,.5)" }
  };
  var EQR_SOURCE_LABELS = {
    achievement: "ACHIEVEMENT REWARD",
    mail: "ADMIN GIFT",
    quest: "QUEST REWARD",
    boss: "BOSS REWARD",
    attendance: "ATTENDANCE REWARD",
    recitation: "RECITATION REWARD",
    event: "EVENT REWARD",
    store: "STORE REWARD",
    title: "TITLE UNLOCKED",
    system: "SYSTEM GRANT"
  };
  var eqRewardPresent = function(opts) {
    const existing = document.getElementById("eq-reward-overlay");
    if (existing) existing.remove();
    const { title = "Rewards Acquired!", subtitle = "", icon = "\u{1F381}", rarity = "Rare", source = "system", rewards = [], onClose } = opts;
    const rarityKey = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
    const rCol = EQR_RARITY_COLORS[rarityKey] || EQR_RARITY_COLORS.Rare;
    const sourceLabel = EQR_SOURCE_LABELS[source] || "REWARD";
    const overlay = document.createElement("div");
    overlay.id = "eq-reward-overlay";
    const _buildRewardCard = (r, i) => {
      const isTitleReward = r.type === "title";
      const rColor = r.color ? _cssColor(r.color) : null;
      let amtDisplay;
      if (isTitleReward) {
        amtDisplay = `<span class="eqr-reward-amount" style="color:${rColor || "#EC4899"};font-size:14px;letter-spacing:.02em">${_esc(r.label || "Title")}</span>`;
      } else {
        amtDisplay = `<span class="eqr-reward-amount" style="color:${rColor || "var(--on-surface)"}">${typeof r.amount === "number" ? "+" + r.amount.toLocaleString() : _esc(r.amount)}</span>`;
      }
      return `<div class="eqr-reward-card${isTitleReward ? " eqr-reward-title" : ""}" style="border-color:${rColor || "rgba(255,255,255,.1)"};animation-delay:${i * 0.1 + 0.2}s">
      <span class="eqr-reward-icon">${r.icon || "\u{1F381}"}</span>
      ${amtDisplay}
      <span class="eqr-reward-label">${isTitleReward ? "Title Unlocked" : _esc(r.label || "Reward")}</span>
    </div>`;
    };
    const rewardCardsHTML = rewards.length > 0 ? rewards.map((r, i) => _buildRewardCard(r, i)).join("") : '<div class="eqr-no-rewards">\u{1F3C5} Achievement Recorded</div>';
    overlay.innerHTML = `
    <div class="eqr-panel" style="box-shadow:0 0 80px ${rCol.glow},0 40px 80px rgba(0,0,0,.7)">
      <canvas class="eqr-canvas" id="eqr-canvas"></canvas>
      <div class="eqr-shine"></div>
      <div class="eqr-strip"></div>
      <div class="eqr-panel-scroll">
      <div class="eqr-body">
        <div class="eqr-source-label">${sourceLabel}</div>
        <div style="text-align:center">
          <div class="eqr-icon-wrap" style="background:${rCol.bg}">
            ${icon}
            <div class="eqr-icon-ring" style="border-color:${rCol.border}"></div>
            <div class="eqr-icon-ring2" style="border-color:${rCol.border}"></div>
          </div>
          <div class="eqr-rarity-badge" style="background:${rCol.bg};border:1px solid ${rCol.border};color:${rCol.strip}">
            <span style="width:6px;height:6px;border-radius:50%;background:${rCol.strip};display:inline-block"></span>
            ${rarityKey}
          </div>
        </div>
        <div class="eqr-title">${_esc(title)}</div>
        ${subtitle ? `<div class="eqr-subtitle">${_esc(subtitle)}</div>` : ""}
        <div class="eqr-divider"></div>
        ${rewards.length > 0 ? '<div class="eqr-rewards-label">REWARDS ACQUIRED</div>' : ""}
        <div class="eqr-rewards-grid">${rewardCardsHTML}</div>
        <button class="eqr-claim-btn" id="eqr-btn"
          style="background:linear-gradient(135deg,${rCol.strip},${rCol.strip}cc);
          --eqr-btn-glow:0 8px 32px ${rCol.glow}">
          ${rewards.length > 0 ? "\u2728 Awesome!" : "\u2713 Continue"}
        </button>
      </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    _eqrRunParticles("eqr-canvas", rCol);
    document.getElementById("eqr-btn").addEventListener("click", _eqrClose);
    overlay.addEventListener("click", function(e) {
      if (e.target === overlay) _eqrClose();
    });
    function _eqrClose() {
      overlay.style.animation = "eqrFadeOut .25s ease forwards";
      setTimeout(() => {
        overlay.remove();
        if (typeof onClose === "function") onClose();
      }, 260);
    }
  };
  function _eqrRunParticles(canvasId, rCol) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const parent = canvas.parentElement;
    canvas.width = parent.offsetWidth || 480;
    canvas.height = parent.offsetHeight || 400;
    const colors = [rCol.strip, "#d0bcff", "#ffb95f", "#4edea3", "#EC4899", "#fff"];
    const particles = [];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x: canvas.width / 2,
        y: canvas.height * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        life: 1,
        decay: 0.015 + Math.random() * 0.025,
        color: colors[Math.floor(Math.random() * colors.length)],
        w: 4 + Math.random() * 4,
        h: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        rotV: (Math.random() - 0.5) * 0.2
      });
    }
    let frame;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      particles.forEach((p) => {
        if (p.life <= 0) return;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.life -= p.decay;
        p.rot += p.rotV;
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (alive) frame = requestAnimationFrame(draw);
    }
    draw();
    setTimeout(() => {
      cancelAnimationFrame(frame);
    }, 3e3);
  }
  AppStore.subscribe("reward-presenter-boot-badges", function(state, event) {
    if (event.type !== "session:booted") return;
    if (currentRole === "student" && currentUser) {
      setTimeout(() => {
        mailUpdateSidebarBadge();
        achUpdateSidebarBadge();
      }, 400);
    }
  });
  AppStore.subscribe("reward-presenter-nav-badges", function(state, event) {
    if (event.type !== "nav:navigated") return;
    if (currentRole === "student") {
      setTimeout(() => {
        mailUpdateSidebarBadge();
        achUpdateSidebarBadge();
      }, 150);
    }
  });
  console.log("[EduQuest] shared/reward-presenter.js loaded \u2014 eqRewardPresent, _eqrRunParticles, EQR_RARITY_COLORS, EQR_SOURCE_LABELS registered. Subscribers: session:booted, nav:navigated (badge refresh).");

  // src/modules/mail/student-inbox.js
  var renderStudentMail = function() {
    const sid = currentUser.id;
    const msgs = mailGetForStudent(sid);
    const unread = msgs.filter((m) => !mailIsRead(m, sid)).length;
    const unclaimedRewards = msgs.filter((m) => m.hasReward && !mailIsClaimed(m, sid)).length;
    const mailTypeIcons = { announcement: "\u{1F4E2}", reward: "\u{1F381}", gift: "\u{1F380}", event: "\u{1F389}", title: "\u{1F396}\uFE0F", compensation: "\u{1F48E}", general: "\u{1F4EC}" };
    console.log("[Mail] Rendering student mail. Total:", msgs.length, "Unread:", unread, "Unclaimed:", unclaimedRewards);
    msgs.forEach((m, idx) => {
      console.log(`[Mail] ${idx}: ${m.id} - Claimed: ${mailIsClaimed(m, sid)} - HasReward: ${m.hasReward}`);
    });
    document.getElementById("s-mail").innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#0d1525,#1a0a2e)">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">\u{1F4EC} INBOX // MESSAGES</div>
      <h1 style="font-size:30px;font-family:var(--fh);font-weight:900">Mail</h1>
      <p>Messages from your teacher, including announcements and special rewards.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${msgs.length}</div><div class="lbl">Messages</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:${unread > 0 ? "#EC4899" : "var(--secondary)"}">${unread}</div><div class="lbl">Unread</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${unclaimedRewards}</div><div class="lbl">Rewards</div></div>
      </div>
    </div>
  </div>

  ${unclaimedRewards > 0 ? `
  <div style="background:linear-gradient(135deg,rgba(255,185,95,.1),rgba(236,72,153,.07));border:1px solid rgba(255,185,95,.3);border-radius:14px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-size:24px">\u{1F381}</div>
    <div style="flex:1">
      <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--tertiary)">${unclaimedRewards} Unclaimed Mail Reward${unclaimedRewards > 1 ? "s" : ""}</div>
      <div style="font-size:12px;color:var(--text-muted)">Open the mail items below to claim your rewards.</div>
    </div>
  </div>` : ""}

  ${msgs.length === 0 ? `
  <div class="mail-empty">
    <div class="mail-empty-icon">\u{1F4ED}</div>
    <div class="mail-empty-title">Your inbox is empty</div>
    <div class="mail-empty-sub">Messages from your teacher will appear here.</div>
  </div>` : `
  <div class="mail-list" id="mail-list">
    ${msgs.map((m) => {
      const isRead = mailIsRead(m, sid);
      const isClaimed = mailIsClaimed(m, sid);
      const icon = mailTypeIcons[m.type] || "\u{1F4EC}";
      const timeStr = new Date(m.sentAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<div class="mail-item${isRead ? "" : " unread"}" onclick="mailOpenDetail('${m.id}')">
        <div class="mail-item-icon">${icon}</div>
        <div class="mail-item-body">
          <div class="mail-item-from">
            <span class="material-symbols-outlined" style="font-size:12px">school</span>
            ${_esc(m.sender || "Teacher")}
          </div>
          <div class="mail-item-subject">${_esc(m.subject)}</div>
          <div class="mail-item-preview">${_esc((m.body || "").slice(0, 80))}${(m.body || "").length > 80 ? "\u2026" : ""}</div>
        </div>
        <div class="mail-item-meta">
          <span class="mail-item-time">${timeStr}</span>
          ${m.hasReward && !isClaimed ? '<span class="mail-has-reward">\u{1F381} REWARD</span>' : ""}
          ${!isRead ? '<div class="mail-unread-dot"></div>' : ""}
        </div>
      </div>`;
    }).join("")}
  </div>`}`;
    mailUpdateSidebarBadge();
  };
  var mailOpenDetail = function(mailId) {
    const sid = currentUser.id;
    const m = (AppStore.getSlice((s) => s.mail) || []).find((x) => x.id === mailId);
    if (!m) {
      console.error("[Mail] Mail not found:", mailId);
      return;
    }
    console.log("[Mail] Opening detail for mail:", mailId);
    mailMarkRead(mailId, sid);
    mailUpdateSidebarBadge();
    const freshM = (AppStore.getSlice((s) => s.mail) || []).find((x) => x.id === mailId);
    const isRead = mailIsRead(freshM || m, sid);
    const isClaimed = mailIsClaimed(freshM || m, sid);
    const timeStr = new Date((freshM || m).sentAt).toLocaleString("en-PH", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const mailTypeIcons = { announcement: "\u{1F4E2}", reward: "\u{1F381}", gift: "\u{1F380}", event: "\u{1F389}", title: "\u{1F396}\uFE0F", compensation: "\u{1F48E}", general: "\u{1F4EC}" };
    const icon = mailTypeIcons[(freshM || m).type] || "\u{1F4EC}";
    let rewardHTML = "";
    if ((freshM || m).hasReward) {
      const chips = ((freshM || m).rewards || []).map((r) => `
      <div class="mail-reward-chip" style="color:${r.color || "var(--primary)"};border-color:${r.color || "rgba(208,188,255,.3)"}33;background:${r.color || "rgba(208,188,255,.08)"}11">
        <span>${r.icon || "\u{1F381}"}</span>
        <span>${typeof r.amount === "number" ? "+" + r.amount.toLocaleString() : r.amount} ${r.label || ""}</span>
      </div>`).join("");
      const claimBtn = isClaimed ? `<div class="mail-claimed-badge"><span class="material-symbols-outlined" style="font-size:18px">check_circle</span> Rewards Claimed</div>` : `<button class="mail-claim-btn" onclick="mailDoClaimRewards('${mailId}')">
           <span class="material-symbols-outlined">redeem</span>
           Claim Rewards
         </button>`;
      rewardHTML = `
      <div class="mail-reward-box">
        <div class="mail-reward-box-title">ATTACHED REWARDS</div>
        <div class="mail-reward-chips-row">${chips}</div>
      </div>
      ${claimBtn}`;
    }
    showModal(`
    <div class="mail-detail">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.14em">MAIL // MESSAGE_DETAIL</div>
        <button class="btn btn-ghost btn-xs" onclick="closeModalForce();renderStudentMail()">\u2190 Back</button>
      </div>
      <div class="mail-detail-header">
        <div class="mail-detail-subject">${_esc((freshM || m).subject)}</div>
        <div class="mail-detail-from">
          <div class="mail-detail-avatar">MS</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc((freshM || m).sender || "Teacher")}</div>
            <div class="mail-detail-meta-text">${timeStr}</div>
          </div>
          <div style="margin-left:auto">
            ${icon}
            <span class="badge-pill bp-gray" style="font-size:10px;margin-left:6px">${(freshM || m).type || "general"}</span>
          </div>
        </div>
      </div>
      <div class="mail-detail-body">${_esc((freshM || m).body || "")}</div>
      ${rewardHTML}
    </div>
  `, "md");
  };
  var mailDoClaimRewards = function(mailId) {
    if (!currentUser || currentRole !== "student") {
      toast("\u274C You must be logged in as a student", "#ffb4ab");
      return;
    }
    console.log("[Mail] Starting claim for mail:", mailId, "Student:", currentUser.id);
    const rewards = mailClaimRewards(mailId, currentUser.id);
    if (!rewards || Array.isArray(rewards) && rewards.length === 0) {
      console.warn("[Mail] Claim returned no rewards or false");
      toast("\u274C Rewards already claimed or mail not found.", "#ffb4ab");
      return;
    }
    closeModalForce();
    let rarity = "Common";
    if (rewards && rewards.length > 0) {
      const hasTitle = rewards.some((r) => r.type === "title");
      const hasCoin = rewards.some((r) => r.type === "coins" && parseInt(r.amount || 0) > 100);
      const hasXP = rewards.some((r) => r.type === "xp" && parseInt(r.amount || 0) > 200);
      if (hasTitle) rarity = "Legendary";
      else if (hasCoin || hasXP) rarity = "Rare";
    }
    const MAIL_ICONS = { announcement: "\u{1F4E2}", reward: "\u{1F381}", gift: "\u{1F380}", event: "\u{1F389}", title: "\u{1F396}\uFE0F", compensation: "\u{1F48E}", general: "\u{1F4EC}" };
    const mailIcon = MAIL_ICONS[rewards && rewards.length > 0 ? "reward" : "general"] || "\u{1F4EC}";
    eqRewardPresent({
      title: "Mail Rewards Claimed!",
      subtitle: rewards && rewards.length > 0 ? "Excellent rewards!" : "Message received",
      icon: mailIcon,
      rarity,
      source: "mail",
      rewards: rewards || [],
      onClose: () => {
        console.log("[Mail] Reward presentation closed, refreshing mail view");
        renderStudentMail();
      }
    });
  };

  // build/test-helpers/student-inbox-combined-entry.js
  window.AppStore = AppStore;
  window.eqRewardPresent = eqRewardPresent;
  window.renderStudentMail = renderStudentMail;
  window.mailOpenDetail = mailOpenDetail;
  window.mailDoClaimRewards = mailDoClaimRewards;
})();
