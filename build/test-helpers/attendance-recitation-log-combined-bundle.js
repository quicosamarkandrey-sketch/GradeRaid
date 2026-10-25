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

  // src/modules/attendance/attendance-recitation-log.js
  var _talSection = "all";
  var _talType = "all";
  var _talRange = "all";
  var _talSearch = "";
  var _talPage = 1;
  var _TAL_PAGE_SIZE = 20;
  var _talSearchDebounce = null;
  var _TAL_SUBSCRIBER_KEY = "recitation-attendance-log";
  var _TAL_STATUS_COLORS = { "Early": "#7fd8ff", "On Time": "#4edea3", "Late": "#ffd166", "Absent": "#ffb4ab", "Excused": "#c4b5fd" };
  var _TAL_STATUS_ICONS = { "Early": "\u{1F305}", "On Time": "\u2705", "Late": "\u23F0", "Absent": "\u274C", "Excused": "\u{1F4DD}" };
  var renderRecitationAttendanceLog = function() {
    const el = document.getElementById("a-class-logs");
    if (!el) return;
    if (typeof AppStore !== "undefined" && AppStore.subscribe) {
      AppStore.subscribe(_TAL_SUBSCRIBER_KEY, (state, event) => {
        const type = event && event.type;
        if (type === "attendance:scan-recorded" || type === "attendance:override" || type === "attendance:session-closed" || type && type.indexOf("recitation:") === 0 || type && type.indexOf("sections:") === 0 || type === "state:remote-sync" || type === "state:legacy-sync") {
          if (document.getElementById("a-class-logs")) _talPaint();
        }
      });
    }
    _talPaint();
  };
  var unmountRecitationAttendanceLog = function() {
    if (typeof AppStore !== "undefined" && AppStore.unsubscribe) AppStore.unsubscribe(_TAL_SUBSCRIBER_KEY);
  };
  var talSetSection = function(sectionId) {
    _talSection = sectionId || "all";
    _talPage = 1;
    _talPaint();
  };
  var talSetType = function(type) {
    _talType = type || "all";
    _talPage = 1;
    _talPaint();
  };
  var talSetRange = function(range) {
    _talRange = range || "all";
    _talPage = 1;
    _talPaint();
  };
  var talSetSearch = function(value) {
    clearTimeout(_talSearchDebounce);
    _talSearchDebounce = setTimeout(() => {
      _talSearch = String(value || "").trim();
      _talPage = 1;
      _talPaint();
    }, 220);
  };
  var talClearFilters = function() {
    _talSection = "all";
    _talType = "all";
    _talRange = "all";
    _talSearch = "";
    _talPage = 1;
    _talPaint();
  };
  var talGoToPage = function(page) {
    _talPage = Math.max(1, page | 0);
    _talPaint();
    const table = document.getElementById("a-class-logs");
    if (table) table.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  var talPrevPage = function() {
    window.talGoToPage(_talPage - 1);
  };
  var talNextPage = function() {
    window.talGoToPage(_talPage + 1);
  };
  var talExportCsv = function() {
    const state = AppStore.getState();
    const rows = _talApplyNonSectionFilters(_talBuildEntries(state), state).filter((e) => _talMatchesSection(e));
    if (!rows.length) {
      if (typeof toast === "function") toast("Nothing to export for the current filters.");
      return;
    }
    const header = ["Date", "Time", "Student", "Section", "Type", "Detail"];
    const lines = [header.join(",")];
    rows.forEach((e) => {
      const cells = [
        e.date || "",
        e.dt ? _talFormatTime(e.dt) : "",
        e.studentName || "",
        _talSectionLabel(e.classId, state),
        e.type === "attendance" ? "Attendance" : "Recitation",
        e.type === "attendance" ? e.status || "" : `+${e.pts || 0} pts${e.detail ? " \u2014 " + e.detail : ""}`
      ].map((v) => '"' + String(v).replace(/"/g, '""') + '"');
      lines.push(cells.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `class-log-${typeof isoDate === "function" ? isoDate() : "export"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  };
  function _talPaint() {
    const el = document.getElementById("a-class-logs");
    if (!el) return;
    const state = AppStore.getState();
    const allEntries = _talBuildEntries(state);
    const scopedEntries = _talApplyNonSectionFilters(allEntries, state);
    const sectionOptions = _talSectionOptions(state, allEntries);
    const visibleEntries = scopedEntries.filter((e) => _talMatchesSection(e));
    el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">\u{1F5D2}\uFE0F Class Records</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Recitation &amp; Attendance Log</h1>
      <p style="font-size:14px;color:var(--text-muted)">${typeof getMySectionsLabel === "function" ? _esc(getMySectionsLabel(state)) : "All Sections"} \xB7 every recitation point and attendance scan, in one place</p>
    </div>
  </div>

  ${_talOverviewStatGrid(scopedEntries)}
  ${_talFilterBar(sectionOptions)}
  ${_talSection === "all" ? _talSectionOverviewGrid(state, scopedEntries, sectionOptions) : _talSectionHeader(state, sectionOptions)}
  ${_talTable(visibleEntries, state)}
  `;
  }
  function _talMySectionIds(state) {
    const uid = typeof currentUser !== "undefined" && currentUser ? currentUser.id : null;
    const isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";
    const ids = /* @__PURE__ */ new Set();
    (state.classSections || []).forEach((s) => {
      if (s.archived) return;
      if (isAdmin || uid && s.adviserId === uid) ids.add(s.id);
    });
    (state.attendanceLogs || []).forEach((a) => {
      if (a.classId) ids.add(a.classId);
    });
    (state.recitationLog || []).forEach((r) => {
      if (r.classId) ids.add(r.classId);
    });
    (state.students || []).forEach((s) => {
      ids.add(s.classId || "default-class");
    });
    if (!ids.size && typeof getActiveClassIds === "function") {
      getActiveClassIds(state).forEach((id) => ids.add(id));
    }
    return Array.from(ids);
  }
  function _talSectionLabel(classId, state) {
    if (!classId) return "Unassigned / Legacy";
    if (typeof getClassLabel === "function") return getClassLabel(classId, state);
    return classId;
  }
  function _talBuildEntries(state) {
    const studentsById = {};
    (state.students || []).forEach((s) => {
      studentsById[s.id] = s;
    });
    const nameFor = (sid) => {
      const s = studentsById[sid];
      return s ? s.name || s.displayName || sid : sid;
    };
    const attendance = (state.attendanceLogs || []).map((a) => {
      const dt = a.scannedAt ? new Date(a.scannedAt) : a.logDate ? /* @__PURE__ */ new Date(a.logDate + "T00:00:00+08:00") : null;
      return {
        type: "attendance",
        id: "att_" + (a.id || a.studentId + "_" + a.logDate),
        studentId: a.studentId,
        studentName: nameFor(a.studentId),
        classId: a.classId || null,
        date: a.logDate || (dt ? _talDateKey(dt) : null),
        dt,
        sortKey: dt ? dt.getTime() : 0,
        status: a.status,
        entryMethod: a.entryMethod,
        detail: a.notes || ""
      };
    });
    const recitation = (state.recitationLog || []).map((r) => {
      const dt = r.createdAt ? new Date(r.createdAt) : null;
      return {
        type: "recitation",
        id: "rec_" + (r.id || r.studentId + "_" + r.when),
        studentId: r.studentId,
        studentName: nameFor(r.studentId),
        classId: r.classId || null,
        date: dt ? _talDateKey(dt) : null,
        dt,
        sortKey: dt ? dt.getTime() : 0,
        pts: r.pts,
        detail: r.note || ""
      };
    });
    return attendance.concat(recitation).sort((a, b) => b.sortKey - a.sortKey);
  }
  function _talSectionOptions(state, allEntries) {
    const ids = _talMySectionIds(state);
    const opts = ids.map((id) => ({ id, label: _talSectionLabel(id, state) })).sort((a, b) => a.label.localeCompare(b.label));
    const hasUnassigned = allEntries.some((e) => !e.classId);
    if (hasUnassigned) opts.push({ id: "__unassigned__", label: "Unassigned / Legacy" });
    return opts;
  }
  function _talMatchesSection(e) {
    if (_talSection === "all") return true;
    if (_talSection === "__unassigned__") return !e.classId;
    return e.classId === _talSection;
  }
  function _talApplyNonSectionFilters(entries, state) {
    const today = typeof isoDate === "function" ? isoDate() : null;
    const q = _talSearch.toLowerCase();
    return entries.filter((e) => {
      if (_talType !== "all" && e.type !== _talType) return false;
      if (_talRange === "today") {
        if (!e.date || e.date !== today) return false;
      } else if (_talRange === "7" || _talRange === "30") {
        if (!e.sortKey) return false;
        const days = _talRange === "7" ? 7 : 30;
        if (Date.now() - e.sortKey > days * 864e5) return false;
      }
      if (q && !(e.studentName || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function _talOverviewStatGrid(scopedEntries) {
    const attendance = scopedEntries.filter((e) => e.type === "attendance");
    const recitation = scopedEntries.filter((e) => e.type === "recitation");
    const totalPts = recitation.reduce((a, e) => a + (e.pts || 0), 0);
    const presentCount = attendance.filter((e) => e.status === "Early" || e.status === "On Time").length;
    return `
  <div class="stat-grid">
    <div class="stat-card"><div class="val" style="color:#d0bcff">${scopedEntries.length}</div><div class="lbl">Total Entries</div></div>
    <div class="stat-card"><div class="val" style="color:#4edea3">${attendance.length}</div><div class="lbl">Attendance Logged</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${recitation.length}</div><div class="lbl">Recitation Entries</div></div>
    <div class="stat-card"><div class="val" style="color:#7fd8ff">${totalPts.toLocaleString()}</div><div class="lbl">Recitation Points</div></div>
  </div>
  <div style="font-size:11px;color:var(--text-muted);margin:-16px 0 20px">\u2705 ${presentCount} present-on-time entries in the current filter</div>`;
  }
  function _talFilterBar(sectionOptions) {
    const sectionOpts = sectionOptions.map(
      (s) => `<option value="${_esc(s.id)}" ${_talSection === s.id ? "selected" : ""}>${_esc(s.label)}</option>`
    ).join("");
    const hasFilters = _talSection !== "all" || _talType !== "all" || _talRange !== "all" || _talSearch;
    return `
  <div class="glass-card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Section</label>
      <select id="tal-section-filter" style="width:auto;min-width:210px" onchange="talSetSection(this.value)">
        <option value="all" ${_talSection === "all" ? "selected" : ""}>\u{1F3EB} All My Sections</option>
        ${sectionOpts}
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Type</label>
      <select id="tal-type-filter" style="width:auto;min-width:140px" onchange="talSetType(this.value)">
        <option value="all" ${_talType === "all" ? "selected" : ""}>All Types</option>
        <option value="attendance" ${_talType === "attendance" ? "selected" : ""}>\u{1F4C5} Attendance</option>
        <option value="recitation" ${_talType === "recitation" ? "selected" : ""}>\u{1F3A4} Recitation</option>
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">When</label>
      <select id="tal-range-filter" style="width:auto;min-width:130px" onchange="talSetRange(this.value)">
        <option value="all" ${_talRange === "all" ? "selected" : ""}>All Time</option>
        <option value="today" ${_talRange === "today" ? "selected" : ""}>Today</option>
        <option value="7" ${_talRange === "7" ? "selected" : ""}>Last 7 Days</option>
        <option value="30" ${_talRange === "30" ? "selected" : ""}>Last 30 Days</option>
      </select>
    </div>
    <div style="flex:1;min-width:160px">
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Search student</label>
      <input id="tal-search" type="text" placeholder="Search by name\u2026" value="${_esc(_talSearch)}" oninput="talSetSearch(this.value)">
    </div>
    <button class="btn btn-ghost btn-sm" onclick="talExportCsv()">\u2B07\uFE0F Export CSV</button>
    ${hasFilters ? `<button class="btn btn-ghost btn-sm" onclick="talClearFilters()">Clear filters</button>` : ""}
  </div>`;
  }
  function _talSectionOverviewGrid(state, scopedEntries, sectionOptions) {
    const ids = _talMySectionIds(state);
    const cards = ids.map((id) => {
      const secEntries = scopedEntries.filter((e) => (e.classId || null) === id);
      return _talSectionSummary(id, _talSectionLabel(id, state), secEntries);
    });
    const unassigned = scopedEntries.filter((e) => !e.classId);
    if (unassigned.length) cards.push(_talSectionSummary("__unassigned__", "Unassigned / Legacy", unassigned));
    if (!cards.length) {
      return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No sections found yet. Create a section under Sections to get started.</div>`;
    }
    return `
  <div class="section-header"><span class="material-symbols-outlined">grid_view</span><h2>Sections Overview</h2></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:24px">
    ${cards.map((c) => `
    <div class="glass-card" style="padding:16px;cursor:pointer;transition:transform .15s" onclick="talSetSection('${_esc(c.id)}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
      <div style="font-weight:800;font-size:14px;color:var(--on-surface);margin-bottom:10px">${_esc(c.label)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-bottom:8px">
        <span style="color:${_TAL_STATUS_COLORS["On Time"]}">\u2705 ${c.present}</span>
        <span style="color:${_TAL_STATUS_COLORS["Late"]}">\u23F0 ${c.late}</span>
        <span style="color:${_TAL_STATUS_COLORS["Absent"]}">\u274C ${c.absent}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">\u{1F3A4} ${c.recitationCount} entries \xB7 <span style="color:#ffb95f;font-weight:700">${c.totalPts} pts</span></div>
    </div>`).join("")}
  </div>`;
  }
  function _talSectionSummary(id, label, entries) {
    const attendance = entries.filter((e) => e.type === "attendance");
    const recitation = entries.filter((e) => e.type === "recitation");
    return {
      id,
      label,
      present: attendance.filter((e) => e.status === "Early" || e.status === "On Time").length,
      late: attendance.filter((e) => e.status === "Late").length,
      absent: attendance.filter((e) => e.status === "Absent").length,
      recitationCount: recitation.length,
      totalPts: recitation.reduce((a, e) => a + (e.pts || 0), 0)
    };
  }
  function _talSectionHeader(state, sectionOptions) {
    const opt = sectionOptions.find((s) => s.id === _talSection);
    const label = opt ? opt.label : _talSectionLabel(_talSection === "__unassigned__" ? null : _talSection, state);
    return `
  <div class="section-header">
    <span class="material-symbols-outlined">meeting_room</span>
    <h2>${_esc(label)}</h2>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="talSetSection('all')">\u2190 All Sections</button>
  </div>`;
  }
  function _talTable(entries, state) {
    if (!entries.length) {
      return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No log entries match the current filters.</div>`;
    }
    const cols = "100px 80px 1.2fr 160px 110px 1.3fr";
    const totalPages = Math.max(1, Math.ceil(entries.length / _TAL_PAGE_SIZE));
    if (_talPage > totalPages) _talPage = totalPages;
    const start = (_talPage - 1) * _TAL_PAGE_SIZE;
    const shown = entries.slice(start, start + _TAL_PAGE_SIZE);
    return `
  <div class="section-header"><span class="material-symbols-outlined">receipt_long</span><h2>Log Entries</h2></div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:${cols};gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Date</span><span>Time</span><span>Who</span><span>Section</span><span>Type</span><span>Detail</span>
    </div>
    ${shown.map((e) => _talRow(e, state)).join("")}
  </div>
  ${_talPagination(_talPage, totalPages, entries.length, start + 1, start + shown.length)}`;
  }
  function _talPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
    if (totalPages <= 1) {
      return `<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing all ${totalCount} entries</div>`;
    }
    const nums = /* @__PURE__ */ new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
    const pages = Array.from(nums).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    let btns = "";
    let prevN = 0;
    pages.forEach((n) => {
      if (n - prevN > 1) btns += `<span style="padding:0 6px;color:var(--text-muted);font-size:11px">\u2026</span>`;
      btns += `<button class="btn btn-ghost btn-sm" style="${n === page ? "background:var(--primary);color:#fff;font-weight:800" : ""}" onclick="talGoToPage(${n})">${n}</button>`;
      prevN = n;
    });
    return `
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${page <= 1 ? "disabled" : ""} onclick="talPrevPage()">\u2190 Prev</button>
    ${btns}
    <button class="btn btn-ghost btn-sm" ${page >= totalPages ? "disabled" : ""} onclick="talNextPage()">Next \u2192</button>
  </div>
  <div style="text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)">Showing ${rangeStart}\u2013${rangeEnd} of ${totalCount} entries</div>`;
  }
  function _talRow(e, state) {
    const dateStr = _talFormatDisplayDate(e.date);
    const timeStr = e.dt ? _talFormatTime(e.dt) : "\u2014";
    const sectionLabel = _talSectionLabel(e.classId, state);
    let typeBadge, detail;
    if (e.type === "attendance") {
      const color = _TAL_STATUS_COLORS[e.status] || "var(--text-muted)";
      const icon = _TAL_STATUS_ICONS[e.status] || "\u{1F4C5}";
      typeBadge = `<span class="btn btn-xs" style="width:fit-content;pointer-events:none;background:${color}22;color:${color};border:1px solid ${color}55">${icon} ${_esc(e.status || "\u2014")}</span>`;
      detail = `${e.entryMethod ? `<div style="font-size:10px;color:var(--text-muted)">via ${_esc(e.entryMethod)}</div>` : ""}${e.detail ? `<div style="font-size:11px;color:var(--on-surface)">${_esc(e.detail)}</div>` : ""}`;
    } else {
      const pts = e.pts || 0;
      const color = pts >= 0 ? "#4edea3" : "#ffb4ab";
      typeBadge = `<span class="btn btn-xs" style="width:fit-content;pointer-events:none;background:${color}22;color:${color};border:1px solid ${color}55">\u{1F3A4} ${pts >= 0 ? "+" : ""}${pts} pts</span>`;
      detail = e.detail ? `<div style="font-size:11px;color:var(--on-surface)">${_esc(e.detail)}</div>` : `<div style="font-size:11px;color:var(--text-muted)">\u2014</div>`;
    }
    return `
  <div style="display:grid;grid-template-columns:100px 80px 1.2fr 160px 110px 1.3fr;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border2)">
    <div style="font-size:11px;color:var(--text-muted)">${_esc(dateStr)}</div>
    <div style="font-size:11px;color:var(--text-muted)">${_esc(timeStr)}</div>
    <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc(e.studentName)}</div>
    <div style="font-size:12px;color:var(--on-surface)">${_esc(sectionLabel)}</div>
    <div>${typeBadge}</div>
    <div>${detail}</div>
  </div>`;
  }
  function _talDateKey(d) {
    try {
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    } catch (e) {
      return null;
    }
  }
  function _talFormatDisplayDate(dateKey) {
    if (!dateKey) return "\u2014";
    try {
      const d = /* @__PURE__ */ new Date(dateKey + "T00:00:00+08:00");
      if (isNaN(d.getTime())) return dateKey;
      return d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return dateKey;
    }
  }
  function _talFormatTime(d) {
    try {
      return d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: true });
    } catch (e) {
      return "\u2014";
    }
  }
  console.log("[EduQuest] attendance/attendance-recitation-log.js loaded \u2014 renderRecitationAttendanceLog registered.");

  // build/test-helpers/attendance-recitation-log-combined-entry.js
  window.AppStore = AppStore;
  window.renderRecitationAttendanceLog = renderRecitationAttendanceLog;
  window.unmountRecitationAttendanceLog = unmountRecitationAttendanceLog;
  window.talSetSection = talSetSection;
  window.talSetType = talSetType;
  window.talSetRange = talSetRange;
  window.talSetSearch = talSetSearch;
  window.talClearFilters = talClearFilters;
  window.talGoToPage = talGoToPage;
  window.talPrevPage = talPrevPage;
  window.talNextPage = talNextPage;
  window.talExportCsv = talExportCsv;
})();
