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

  // src/modules/leaderboard/eql-engine.js
  AppStore.ready.then(function eqlMigrate() {
    const labels = {
      recitation: { label: "Recitation", icon: "\u{1F3A4}", color: "#4edea3" },
      boss: { label: "Boss Raider", icon: "\u2694\uFE0F", color: "#EC4899" },
      academic: { label: "Academic", icon: "\u{1F4DA}", color: "#d0bcff" },
      overall: { label: "Overall", icon: "\u{1F3C6}", color: "#ffb95f" }
    };
    const current = AppStore.getSlice((s) => s.leaderboardConfig) || null;
    const needsInit = !current;
    const missingKeys = Object.keys(labels).filter((k) => !(current && current[k]));
    if (!needsInit && missingKeys.length === 0) return;
    AppStore.updateState((draft) => {
      if (!draft.leaderboardConfig) draft.leaderboardConfig = {};
      Object.keys(labels).forEach((k) => {
        if (!draft.leaderboardConfig[k]) {
          draft.leaderboardConfig[k] = Object.assign({ enabled: true, resetAt: null }, labels[k]);
        }
      });
    }, { type: needsInit ? "leaderboard:config-initialized" : "leaderboard:config-backfilled", payload: { keys: needsInit ? Object.keys(labels) : missingKeys } });
  });
  var eqlComputeRecitation = function eqlComputeRecitation2(sid, resetAt, cache) {
    const recitationLog = cache && cache.recitationLog || AppStore.getSlice((s) => s.recitationLog) || [];
    const log = recitationLog.filter((r) => {
      if (r.studentId !== sid) return false;
      if (resetAt) {
        try {
          return new Date(r.createdAt || 0) >= new Date(resetAt);
        } catch (e) {
        }
      }
      return true;
    });
    const totalPts = log.reduce((a, r) => a + (r.pts || 0), 0);
    const sessionCount = log.length;
    const qrCount = log.filter((r) => r.qr === true || (r.note || "").toUpperCase().includes("QR")).length;
    let streak = 0;
    if (log.length > 0) {
      const daySet = new Set(log.map((r) => (r.createdAt || "").slice(0, 10)));
      const dayArr = [...daySet].sort();
      let cur = 1, max = 1;
      for (let i = 1; i < dayArr.length; i++) {
        const a = new Date(dayArr[i - 1]), b = new Date(dayArr[i]);
        const diff = (b - a) / 864e5;
        if (diff <= 1) {
          cur++;
          if (cur > max) max = cur;
        } else cur = 1;
      }
      streak = max;
    }
    const winThreshold = 15;
    const wins = log.filter((r) => (r.pts || 0) >= winThreshold).length;
    return { totalPts, sessionCount, streak, wins, qrCount };
  };
  var eqlComputeBoss = function eqlComputeBoss2(sid, resetAt, cache) {
    let totalDamage = 0, participationCount = 0, victories = 0, mvpCount = 0;
    let totalCrits = 0, totalMinionsKilled = 0, totalCorrect = 0;
    const bossEvents = cache && cache.bossEvents || AppStore.getSlice((s) => s.bossEvents) || [];
    const bossParticipants = cache && cache.bossParticipants || AppStore.getSlice((s) => s.bossParticipants) || {};
    bossEvents.forEach((boss, bi) => {
      if (resetAt) {
        try {
          if (new Date(boss.startedAt || boss.createdAt || 0) < new Date(resetAt)) return;
        } catch (e) {
        }
      }
      const roster = bossParticipants[bi] || {};
      const rec = roster[sid];
      if (!rec) return;
      totalDamage += rec.totalDamage || 0;
      totalCrits += rec.critHits || 0;
      totalMinionsKilled += rec.minionsDefeated || 0;
      totalCorrect += rec.correctAnswers || 0;
      participationCount++;
      if ((boss.status === "ended" || boss.status === "loot") && (rec.totalDamage || 0) > 0) {
        victories++;
      }
      const participants = Object.values(roster);
      if (participants.length > 0) {
        const sorted = [...participants].sort((a, b) => (b.totalDamage || 0) - (a.totalDamage || 0));
        if (sorted[0] && sorted[0].studentId === sid) mvpCount++;
        else if (participants[0] && Object.keys(roster)[0] === sid) mvpCount++;
      }
    });
    return { totalDamage, participationCount, victories, mvpCount, totalCrits, totalMinionsKilled, totalCorrect };
  };
  var eqlComputeAcademic = function eqlComputeAcademic2(sid, resetAt, cache) {
    const pointLog = cache && cache.pointLog || AppStore.getSlice((s) => s.pointLog) || [];
    const questLog = pointLog.filter((e) => {
      if (e.studentId !== sid) return false;
      if (!e.what || !e.what.startsWith("Quest:")) return false;
      if (resetAt) {
        try {
          return new Date(e.when || 0) >= new Date(resetAt);
        } catch (e2) {
        }
      }
      return true;
    });
    const students = cache && cache.students || AppStore.getSlice((s) => s.students) || [];
    const student = students.find((s) => s.id === sid);
    const academicXP = questLog.reduce((a, e) => a + Math.abs(e.pts || 0), 0);
    const quizCount = questLog.length;
    let scores = [];
    questLog.forEach((e) => {
      const m = (e.what || "").match(/\((\d+)%\)/);
      if (m) scores.push(parseInt(m[1]));
    });
    const perfectScores = scores.filter((s) => s >= 100).length;
    const bestScore = scores.length ? Math.max(...scores) : 0;
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const questCompletions = student ? (student.completedQuizzes || []).length : 0;
    let maxPerfectStreak = 0, curStreak = 0;
    [...questLog].reverse().forEach((e) => {
      const m = (e.what || "").match(/\((\d+)%\)/);
      if (m && parseInt(m[1]) >= 100) {
        curStreak++;
        if (curStreak > maxPerfectStreak) maxPerfectStreak = curStreak;
      } else curStreak = 0;
    });
    return { academicXP, quizCount, perfectScores, bestScore, avgScore, questCompletions, perfectStreak: maxPerfectStreak };
  };
  var eqlComputeOverall = function eqlComputeOverall2(sid, resetAt, cache) {
    const R = eqlComputeRecitation(sid, resetAt, cache);
    const B = eqlComputeBoss(sid, resetAt, cache);
    const A = eqlComputeAcademic(sid, resetAt, cache);
    const students = cache && cache.students || AppStore.getSlice((s) => s.students) || [];
    const student = students.find((s) => s.id === sid);
    const baseXP = student ? student.xp || 0 : 0;
    const score = Math.round(
      baseXP * 1 + R.totalPts * 2.5 + B.totalDamage * 0.15 + B.victories * 400 + A.perfectScores * 200 + R.streak * 150 + B.mvpCount * 500
    );
    return {
      score,
      baseXP,
      recitationPts: R.totalPts,
      bossDamage: B.totalDamage,
      bossVictories: B.victories,
      perfectScores: A.perfectScores,
      recitationStreak: R.streak,
      mvpCount: B.mvpCount,
      // raw pillars for display
      recitation: R,
      boss: B,
      academic: A
    };
  };
  var eqlBuildCategory = function eqlBuildCategory2(key) {
    const leaderboardConfig = AppStore.getSlice((s) => s.leaderboardConfig) || {};
    const cfg = leaderboardConfig[key] || {};
    const resetAt = cfg.resetAt || null;
    const activeClassId = window.ActiveSection ? window.ActiveSection.get() : null;
    const allStudents = AppStore.getSlice((s) => s.students) || [];
    const scopedStudents = activeClassId ? allStudents.filter((s) => s.classId === activeClassId) : allStudents;
    const cache = {
      recitationLog: AppStore.getSlice((s) => s.recitationLog) || [],
      bossEvents: AppStore.getSlice((s) => s.bossEvents) || [],
      bossParticipants: AppStore.getSlice((s) => s.bossParticipants) || {},
      pointLog: AppStore.getSlice((s) => s.pointLog) || [],
      students: allStudents
    };
    const entries = scopedStudents.map((student) => {
      let stats, score, scoreLabel;
      switch (key) {
        case "recitation": {
          stats = eqlComputeRecitation(student.id, resetAt, cache);
          score = stats.totalPts;
          scoreLabel = score.toLocaleString() + " pts";
          break;
        }
        case "boss": {
          stats = eqlComputeBoss(student.id, resetAt, cache);
          score = stats.totalDamage;
          scoreLabel = score.toLocaleString() + " DMG";
          break;
        }
        case "academic": {
          stats = eqlComputeAcademic(student.id, resetAt, cache);
          score = stats.academicXP + stats.perfectScores * 200 + stats.questCompletions * 50;
          scoreLabel = score.toLocaleString() + " pts";
          break;
        }
        case "overall":
        default: {
          stats = eqlComputeOverall(student.id, resetAt, cache);
          score = stats.score;
          scoreLabel = score.toLocaleString() + " pts";
          break;
        }
      }
      return { student, stats, score, scoreLabel };
    });
    entries.sort((a, b) => b.score - a.score);
    let currentRank = 1;
    entries.forEach((e, i) => {
      if (i > 0 && entries[i - 1].score === e.score) e.rank = entries[i - 1].rank;
      else {
        e.rank = currentRank;
      }
      currentRank = e.rank + 1;
    });
    return entries;
  };
  var EQL = {
    /**
     * Get ranked leaderboard for a category.
     * @param {string} key  'recitation' | 'boss' | 'academic' | 'overall'
     * @returns {Array}  Sorted entries with rank, student, stats, score, scoreLabel
     */
    getLeaderboard(key) {
      return eqlBuildCategory(key);
    },
    /**
     * Get config for all leaderboard categories.
     */
    getConfig() {
      return AppStore.getSlice((s) => s.leaderboardConfig) || {};
    },
    /**
     * Enable or disable a leaderboard category.
     * @param {string} key
     * @param {boolean} enabled
     */
    setEnabled(key, enabled) {
      const cfg = AppStore.getSlice((s) => s.leaderboardConfig) || {};
      if (!cfg[key]) return;
      AppStore.updateState((draft) => {
        if (draft.leaderboardConfig && draft.leaderboardConfig[key]) {
          draft.leaderboardConfig[key].enabled = !!enabled;
        }
      }, { type: "leaderboard:category-toggled", payload: { key, enabled: !!enabled } });
    },
    /**
     * Reset a leaderboard period (sets resetAt to now; future calculations
     * only count activity after this timestamp).
     * @param {string} key
     */
    resetPeriod(key) {
      const cfg = AppStore.getSlice((s) => s.leaderboardConfig) || {};
      if (!cfg[key]) return;
      AppStore.updateState((draft) => {
        if (draft.leaderboardConfig && draft.leaderboardConfig[key]) {
          draft.leaderboardConfig[key].resetAt = (/* @__PURE__ */ new Date()).toISOString();
        }
      }, { type: "leaderboard:period-reset", payload: { key } });
    },
    /**
     * Clear the reset timestamp so the leaderboard counts all-time activity.
     * @param {string} key
     */
    clearReset(key) {
      const cfg = AppStore.getSlice((s) => s.leaderboardConfig) || {};
      if (!cfg[key]) return;
      AppStore.updateState((draft) => {
        if (draft.leaderboardConfig && draft.leaderboardConfig[key]) {
          draft.leaderboardConfig[key].resetAt = null;
        }
      }, { type: "leaderboard:period-reset-cleared", payload: { key } });
    },
    /**
     * Aggregate statistics for admin overview panel.
     */
    getStats() {
      const keys = ["recitation", "boss", "academic", "overall"];
      const stats = {};
      const leaderboardConfig = AppStore.getSlice((s) => s.leaderboardConfig) || {};
      keys.forEach((k) => {
        const entries = eqlBuildCategory(k);
        const cfg = leaderboardConfig[k] || {};
        stats[k] = {
          enabled: cfg.enabled !== false,
          resetAt: cfg.resetAt || null,
          participantCount: entries.filter((e) => e.score > 0).length,
          totalStudents: entries.length,
          topScore: entries.length ? entries[0].score : 0,
          topStudent: entries.length ? entries[0].student.name : "\u2014"
        };
      });
      return stats;
    }
  };
  (function injectEqlStyles() {
    const style = document.createElement("style");
    style.textContent = `
/* \u2500\u2500 EQL: Leaderboard Category Tabs \u2500\u2500 */
.eql-tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px;overflow-x:auto;flex-shrink:0}
.eql-tab{display:flex;align-items:center;gap:7px;padding:11px 18px;font-size:13px;font-weight:700;
letter-spacing:.03em;color:var(--text-muted);background:none;border:none;cursor:pointer;
border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.eql-tab:hover{color:var(--on-surface)}
.eql-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.eql-tab .eql-tab-icon{font-size:16px}
.eql-tab .eql-count{font-size:10px;padding:1px 6px;border-radius:10px;
background:rgba(208,188,255,.12);color:var(--primary);font-weight:800;margin-left:2px}

/* \u2500\u2500 EQL: Leaderboard Row \u2500\u2500 */
.eql-row{display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:12px;
border:1px solid var(--border);background:rgba(35,31,56,0.7);transition:all .2s;margin-bottom:6px}
.eql-row:hover{border-color:rgba(208,188,255,0.2);background:rgba(35,31,56,0.9)}
.eql-row.me{border-color:rgba(208,188,255,0.45);background:rgba(208,188,255,0.06);
box-shadow:0 0 14px rgba(208,188,255,0.08)}
.eql-row.top3{border-color:rgba(255,185,95,0.2);background:rgba(255,185,95,0.04)}

/* \u2500\u2500 EQL: Rank Badge \u2500\u2500 */
.eql-rank{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;
font-family:var(--fm);font-size:11px;font-weight:900;flex-shrink:0;
background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid rgba(255,255,255,0.08)}
.eql-rank.r1{background:rgba(255,185,95,.15);color:#ffb95f;border-color:rgba(255,185,95,.35)}
.eql-rank.r2{background:rgba(203,213,225,.1);color:#cbd5e1;border-color:rgba(203,213,225,.25)}
.eql-rank.r3{background:rgba(205,127,50,.1);color:#cd7f32;border-color:rgba(205,127,50,.25)}

/* \u2500\u2500 EQL: Avatar \u2500\u2500 */
.eql-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
font-family:var(--fh);font-weight:900;font-size:12px;flex-shrink:0;position:relative;overflow:hidden}

/* \u2500\u2500 EQL: Info block \u2500\u2500 */
.eql-info{flex:1;min-width:0}
.eql-info-name{font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);
display:flex;align-items:center;gap:6px}
.eql-info-sub{font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eql-you-badge{font-size:9px;color:var(--primary);font-family:var(--fm);background:rgba(208,188,255,.12);
padding:1px 6px;border-radius:6px;border:1px solid rgba(208,188,255,.2)}

/* \u2500\u2500 EQL: Score cell \u2500\u2500 */
.eql-score{text-align:right;flex-shrink:0;min-width:80px}
.eql-score-main{font-family:var(--fh);font-size:14px;font-weight:900}
.eql-score-label{font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;
text-transform:uppercase;margin-top:1px}

/* \u2500\u2500 EQL: Stat pills below row \u2500\u2500 */
.eql-stat-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.eql-stat-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;
font-size:10px;font-weight:700;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
color:var(--text-muted)}

/* \u2500\u2500 EQL: Empty state \u2500\u2500 */
.eql-empty{text-align:center;padding:60px 20px;color:var(--text-muted)}
.eql-empty-icon{font-size:48px;margin-bottom:12px}
.eql-empty-title{font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface);margin-bottom:6px}
.eql-empty-sub{font-size:13px;line-height:1.5}

/* \u2500\u2500 EQL: Admin panel \u2500\u2500 */
.eql-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:28px}
.eql-admin-card{background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:16px;
padding:20px;backdrop-filter:blur(12px);position:relative;overflow:hidden;transition:border .2s}
.eql-admin-card.disabled{opacity:.55}
.eql-admin-card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px}
.eql-admin-card-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;
justify-content:center;font-size:22px;flex-shrink:0;border:1px solid rgba(255,255,255,.08);
background:rgba(255,255,255,.04)}
.eql-admin-card-title{font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.eql-admin-card-sub{font-size:11px;color:var(--text-muted)}
.eql-toggle{width:42px;height:24px;border-radius:12px;border:none;cursor:pointer;position:relative;
flex-shrink:0;transition:background .2s;background:rgba(255,255,255,.1)}
.eql-toggle.on{background:#8b5cf6}
.eql-toggle::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;
border-radius:50%;background:#fff;transition:transform .2s}
.eql-toggle.on::after{transform:translateX(18px)}
.eql-admin-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.eql-admin-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);
border-radius:10px;padding:10px 12px;text-align:center}
.eql-admin-stat-val{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)}
.eql-admin-stat-lbl{font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;
text-transform:uppercase;margin-top:3px}
.eql-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
.eql-reset-badge{font-size:10px;color:var(--text-muted);margin-top:8px;padding:4px 10px;
background:rgba(255,255,255,.03);border-radius:6px;border:1px solid rgba(255,255,255,.06)}

/* \u2500\u2500 EQL: Category header accent strip \u2500\u2500 */
.eql-admin-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:16px 16px 0 0}
.eql-admin-card.cat-recitation::before{background:linear-gradient(90deg,#4edea3,#06b6d4)}
.eql-admin-card.cat-boss::before{background:linear-gradient(90deg,#EC4899,#9333ea)}
.eql-admin-card.cat-academic::before{background:linear-gradient(90deg,#8b5cf6,#d0bcff)}
.eql-admin-card.cat-overall::before{background:linear-gradient(90deg,#ffb95f,#f97316)}

/* \u2500\u2500 EQL: Overall podium override \u2500\u2500 */
.eql-podium{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin-bottom:28px}
.eql-podium-slot{display:flex;flex-direction:column;align-items:center;gap:6px}
.eql-podium-slot.rank1 .eql-podium-block{height:72px;background:rgba(255,185,95,.18);border-color:rgba(255,185,95,.4)}
.eql-podium-slot.rank2 .eql-podium-block{height:54px;background:rgba(203,213,225,.1);border-color:rgba(203,213,225,.25)}
.eql-podium-slot.rank3 .eql-podium-block{height:42px;background:rgba(205,127,50,.1);border-color:rgba(205,127,50,.25)}
.eql-podium-block{width:70px;border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.08);
display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:12px;
font-weight:900;color:var(--text-muted)}
.eql-podium-av{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
font-family:var(--fh);font-weight:900;font-size:14px;position:relative;overflow:hidden}
.eql-podium-medal{font-size:20px;line-height:1}
.eql-podium-name{font-family:var(--fh);font-size:11px;font-weight:800;color:var(--on-surface);text-align:center;max-width:70px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eql-podium-score{font-size:10px;color:var(--text-muted);font-weight:700;text-align:center}

/* \u2500\u2500 EQL: Disabled category notice \u2500\u2500 */
.eql-disabled-notice{text-align:center;padding:40px 20px;background:rgba(255,255,255,.02);
border:1px dashed rgba(255,255,255,.08);border-radius:14px;color:var(--text-muted);font-size:13px}
  `;
    document.head.appendChild(style);
  })();
  console.log("[EQL] eql-engine.js loaded. Categories: recitation, boss, academic, overall.");

  // src/modules/leaderboard/admin-leaderboard.js
  var KEYS = ["recitation", "boss", "academic", "overall"];
  var DEFAULTS = {
    recitation: { label: "Recitation", icon: "\u{1F3A4}", color: "#4edea3" },
    boss: { label: "Boss Raider", icon: "\u2694\uFE0F", color: "#EC4899" },
    academic: { label: "Academic", icon: "\u{1F4DA}", color: "#d0bcff" },
    overall: { label: "Overall", icon: "\u{1F3C6}", color: "#ffb95f" }
  };
  function _esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _cfg(key) {
    const base = DEFAULTS[key] || { label: key, icon: "\u{1F4CA}", color: "#d0bcff" };
    const saved = (DB.leaderboardConfig || {})[key] || {};
    return Object.assign({}, base, saved);
  }
  function _fmtDate(iso) {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return iso;
    }
  }
  var renderAdminLeaderboards = function renderAdminLeaderboards2() {
    const page = document.getElementById("a-leaderboard");
    if (!page) {
      console.error("[EQL admin] #a-leaderboard page div not found.");
      return;
    }
    AppStore.ready.then(function() {
      const stats = EQL.getStats();
      const cards = KEYS.map((key) => {
        const cfg = _cfg(key);
        const st = stats[key] || {};
        const enabled = cfg.enabled !== false;
        const resetAt = cfg.resetAt || null;
        return `
        <div class="eql-admin-card cat-${_esc(key)} ${enabled ? "" : "disabled"}" id="eql-card-${_esc(key)}">
          <div class="eql-admin-card-header">
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
              <div class="eql-admin-card-icon" style="color:${_esc(cfg.color)}">
                ${_esc(cfg.icon)}
              </div>
              <div>
                <div class="eql-admin-card-title">${_esc(cfg.label)}</div>
                <div class="eql-admin-card-sub">${_esc(key)} leaderboard</div>
              </div>
            </div>
            <button class="eql-toggle ${enabled ? "on" : ""}"
              title="${enabled ? "Click to disable" : "Click to enable"}"
              onclick="window.eqlToggle('${_esc(key)}')"></button>
          </div>

          <div class="eql-admin-stats">
            <div class="eql-admin-stat">
              <div class="eql-admin-stat-val" style="color:${_esc(cfg.color)}">${st.participantCount || 0}</div>
              <div class="eql-admin-stat-lbl">With Score</div>
            </div>
            <div class="eql-admin-stat">
              <div class="eql-admin-stat-val">${st.totalStudents || 0}</div>
              <div class="eql-admin-stat-lbl">Total Students</div>
            </div>
            <div class="eql-admin-stat" style="grid-column:1/-1">
              <div class="eql-admin-stat-val" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${_esc(st.topStudent || "\u2014")}
              </div>
              <div class="eql-admin-stat-lbl">Top Student \xB7 ${(st.topScore || 0).toLocaleString()} pts</div>
            </div>
          </div>

          ${resetAt ? `
            <div class="eql-reset-badge">
              \u{1F4C5} Active period from: <strong>${_esc(_fmtDate(resetAt))}</strong>
            </div>
          ` : ""}

          <div class="eql-admin-actions" style="margin-top:${resetAt ? "8px" : "0"}">
            <button class="btn btn-ghost btn-sm" onclick="window.eqlAdminPreview('${_esc(key)}')">
              \u{1F441} Preview
            </button>
            <button class="btn btn-ghost btn-sm" onclick="window.eqlAdminResetConfirm('${_esc(key)}')">
              \u{1F504} New Period
            </button>
            ${resetAt ? `
              <button class="btn btn-ghost btn-sm" onclick="window.eqlDoClearReset('${_esc(key)}')">
                \u21A9 All-Time
              </button>
            ` : ""}
          </div>
        </div>
      `;
      }).join("");
      page.innerHTML = `
      <div style="max-width:960px;margin:0 auto;padding:28px 24px">

        <div style="margin-bottom:28px">
          <h2 style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface);margin:0 0 4px">
            \u{1F3C6} Leaderboard Admin
          </h2>
          <p style="font-size:13px;color:var(--text-muted);margin:0">
            Toggle categories, preview current standings, and manage scoring periods.
            A "New Period" reset keeps all-time history \u2014 only the ranking window changes.
          </p>
        </div>

        <div class="eql-admin-grid">
          ${cards}
        </div>

      </div>
    `;
    });
  };
  var eqlToggle = function eqlToggle2(key) {
    const cfg = _cfg(key);
    const enabled = cfg.enabled !== false;
    EQL.setEnabled(key, !enabled);
    toast(`${_esc(cfg.icon)} ${_esc(cfg.label)} leaderboard ${!enabled ? "enabled" : "disabled"}.`, !enabled ? "#4edea3" : "#ffb95f");
    window.renderAdminLeaderboards();
  };
  var eqlAdminPreview = function eqlAdminPreview2(key) {
    const cfg = _cfg(key);
    const entries = eqlBuildCategory(key);
    const top10 = entries.slice(0, 10);
    const resetAt = cfg.resetAt || null;
    const rows = top10.length ? top10.map((e) => {
      const r = e.rank;
      const rankCls = r === 1 ? "r1" : r === 2 ? "r2" : r === 3 ? "r3" : "";
      const rankLabel = r === 1 ? "\u{1F947}" : r === 2 ? "\u{1F948}" : r === 3 ? "\u{1F949}" : r;
      const color = e.student.color || "#8b5cf6";
      const init = e.student.init || (e.student.name || "?")[0];
      return `
      <div class="eql-row ${r <= 3 ? "top3" : ""}">
        <div class="eql-rank ${rankCls}">${rankLabel}</div>
        <div class="eql-av" style="background:${_esc(color)}22;color:${_esc(color)}">${_esc(init)}</div>
        <div class="eql-info">
          <div class="eql-info-name">${_esc(e.student.name || e.student.displayName || "\u2014")}</div>
        </div>
        <div class="eql-score">
          <div class="eql-score-main" style="color:${_esc(cfg.color)}">${_esc(e.scoreLabel)}</div>
        </div>
      </div>
    `;
    }).join("") : `
    <div class="eql-empty">
      <div class="eql-empty-icon">${_esc(cfg.icon)}</div>
      <div class="eql-empty-title">No scores yet</div>
      <div class="eql-empty-sub">No students have logged ${_esc(cfg.label)} activity yet.</div>
    </div>
  `;
    showModal(`
    <div style="padding:8px 4px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <span style="font-size:26px">${_esc(cfg.icon)}</span>
        <div>
          <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface)">${_esc(cfg.label)} Rankings</div>
          <div style="font-size:11px;color:var(--text-muted)">${resetAt ? "Period from " + _esc(_fmtDate(resetAt)) : "All-time"} \xB7 Top ${top10.length} of ${entries.length}</div>
        </div>
      </div>
      ${rows}
      <div style="margin-top:16px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Close</button>
      </div>
    </div>
  `, "md");
  };
  var eqlAdminResetConfirm = function eqlAdminResetConfirm2(key) {
    const cfg = _cfg(key);
    showModal(`
    <div style="padding:8px 4px;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">${_esc(cfg.icon)}</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface);margin-bottom:8px">
        Start new ${_esc(cfg.label)} period?
      </div>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin:0 0 20px">
        Rankings will show only activity <strong>from this moment forward</strong>.
        All-time records are preserved \u2014 "All-Time" mode restores them any time.
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="closeModalForce(); window.eqlDoReset('${_esc(key)}');">
          \u2705 Start New Period
        </button>
      </div>
    </div>
  `, "sm");
  };
  var eqlDoReset = function eqlDoReset2(key) {
    EQL.resetPeriod(key);
    const cfg = _cfg(key);
    toast(`\u{1F504} ${_esc(cfg.label)} period reset. Rankings now start from today.`, "#4edea3");
    window.renderAdminLeaderboards();
  };
  var eqlDoClearReset = function eqlDoClearReset2(key) {
    EQL.clearReset(key);
    const cfg = _cfg(key);
    toast(`\u21A9 ${_esc(cfg.label)} back to all-time mode.`, "#d0bcff");
    window.renderAdminLeaderboards();
  };
  console.log("[EQL] admin-leaderboard.js loaded \u2014 renderAdminLeaderboards / eqlToggle / eqlAdminPreview / eqlAdminResetConfirm / eqlDoReset / eqlDoClearReset registered.");

  // build/bridges/admin-leaderboard.bridge.js
  window.renderAdminLeaderboards = renderAdminLeaderboards;
  window.eqlToggle = eqlToggle;
  window.eqlAdminPreview = eqlAdminPreview;
  window.eqlAdminResetConfirm = eqlAdminResetConfirm;
  window.eqlDoReset = eqlDoReset;
  window.eqlDoClearReset = eqlDoClearReset;
})();
