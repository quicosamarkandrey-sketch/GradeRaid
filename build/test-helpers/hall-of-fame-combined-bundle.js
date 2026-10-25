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

  // src/utils.js
  function uid2() {
    return "id_" + Math.random().toString(36).substr(2, 9);
  }
  function _esc2(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function _cssColor2(s, fallback) {
    fallback = fallback || "#8b5cf6";
    const v = String(s || "").trim();
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    if (/^var\(--[a-zA-Z0-9-]+\)$/.test(v)) return v;
    return fallback;
  }

  // build/test-helpers/hall-of-fame-globals.js
  window.AppStore = AppStore;
  window._esc = _esc2;
  window.uid = uid2;
  window._cssColor = _cssColor2;

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

  // src/modules/titles/titles_badge_renderer.js
  var TS_RARITY_ENHANCEMENTS = {
    Common: { shadowSpread: 8, glowMul: 0.15, label: "Common" },
    Uncommon: { shadowSpread: 10, glowMul: 0.28, label: "Uncommon" },
    Rare: { shadowSpread: 14, glowMul: 0.45, label: "Rare" },
    Epic: { shadowSpread: 18, glowMul: 0.65, label: "Epic" },
    Legendary: { shadowSpread: 24, glowMul: 0.85, label: "Legendary" },
    Mythic: { shadowSpread: 30, glowMul: 1, label: "Mythic" }
  };
  var TS_RARITY = TS_RARITY_ENHANCEMENTS;
  var TS_BORDER_STYLES = [
    { id: "none", label: "None", cssClass: "" },
    { id: "solid", label: "Solid", cssClass: "" },
    { id: "double", label: "Double", cssClass: "tsb-double" },
    { id: "dashed", label: "Dashed", cssClass: "tsb-dashed" },
    { id: "flame", label: "Flame", cssClass: "tsb-flame" },
    { id: "scale", label: "Scale", cssClass: "tsb-scale" },
    { id: "crystal", label: "Crystal", cssClass: "tsb-crystal" },
    { id: "shadow", label: "Shadow", cssClass: "tsb-shadow" },
    { id: "ghost", label: "Ghost", cssClass: "tsb-ghost" },
    { id: "poison", label: "Poison", cssClass: "tsb-poison" },
    { id: "custom", label: "Custom", cssClass: "" }
  ];
  var tsBuildBadgeHTML = function(title, opts) {
    if (!title) return "";
    opts = opts || {};
    const rCfg = TS_RARITY[title.rarity] || TS_RARITY.Common;
    const bg = title.bgColor || "#1a1438";
    const border = _cssColor(title.borderColor, "#8b5cf6");
    const glow = _cssColor(title.glowColor, "#8b5cf6");
    const text = title.textColor || "#ffffff";
    const gradFrom = title.gradientFrom || "#8b5cf6";
    const gradTo = title.gradientTo || "#4edea3";
    const spread = opts.small ? rCfg.shadowSpread * 0.6 : rCfg.shadowSpread;
    const alpha = opts.small ? rCfg.glowMul * 0.7 : rCfg.glowMul;
    function h2rgba(hex, a) {
      const r = parseInt((hex || "#8b5cf6").slice(1, 3), 16) || 139;
      const g = parseInt((hex || "#8b5cf6").slice(3, 5), 16) || 92;
      const b = parseInt((hex || "#8b5cf6").slice(5, 7), 16) || 246;
      return `rgba(${r},${g},${b},${a})`;
    }
    const glowShadow = `0 0 ${spread}px ${h2rgba(glow, alpha)}`;
    const glowMax = `0 0 ${spread * 2}px ${h2rgba(glow, Math.min(1, alpha * 1.6))}`;
    const cssVars = [
      `--ts-bg:${bg}`,
      `--ts-border:${border}`,
      `--ts-glow:${glow}`,
      `--ts-grad-from:${gradFrom}`,
      `--ts-grad-to:${gradTo}`,
      `--ts-primary:${title.primaryColor || "#d0bcff"}`,
      `--ts-accent:${title.accentColor || gradTo || "#fde047"}`,
      `--ts-glow-shadow:${glowShadow}`,
      `--ts-glow-shadow-max:${glowMax}`,
      `--ts-text:${text}`
    ].join(";");
    const bStyleDef = TS_BORDER_STYLES.find((b) => b.id === (title.borderStyle || "solid")) || TS_BORDER_STYLES[1];
    const borderClass = bStyleDef.cssClass || "";
    const rarityClass = "ts-rarity-" + (title.rarity || "Common").toString().toLowerCase();
    const useLegacyBorderClass = !title.frameTemplate || title.frameTemplate === "solid";
    const customBorderStyle = title.customBorderCSS && title.borderStyle === "custom" ? `border:${title.customBorderCSS};` : "";
    let animClass = "";
    if (title.animation && title.animation !== "none" && title.animation !== "custom")
      animClass = `ts-anim-${title.animation}`;
    const customAnimStyle = title.customAnimationCSS && title.animation === "custom" ? `animation:${title.customAnimationCSS};` : "";
    let bgClass = "";
    if (title.bgEffect && title.bgEffect !== "none" && title.bgEffect !== "custom")
      bgClass = `tsbg-${title.bgEffect}`;
    let effectClass = "";
    if (title.effect && title.effect !== "none") effectClass = `ts-effect-${title.effect}`;
    const customBgStyle = title.customBgCSS && title.bgEffect === "custom" ? `background:${title.customBgCSS};` : "";
    const sizeClass = opts.xs ? "ts-size-xs" : opts.small ? "ts-size-sm" : "";
    const frameShape = (title.frameShape || title.frameTemplate || title.borderStyle || "classic").toString().toLowerCase();
    const frameStyleId = (title.frameStyle || "none").toString().toLowerCase();
    const frameClass = "ts-frame-" + frameShape;
    const styleClass = frameStyleId !== "none" ? "ts-style-" + frameStyleId : "";
    const wrapperClasses = ["ts-badge-wrap", frameClass, styleClass, useLegacyBorderClass ? borderClass : "", bgClass, animClass, effectClass, rarityClass, sizeClass].filter(Boolean).join(" ");
    const wrapperInlineStyle = [cssVars, `background:${customBgStyle ? "" : "transparent"}`, customBgStyle, `border-color:${border}`, `box-shadow:${glowShadow}`, customBorderStyle, customAnimStyle, opts.style || ""].filter(Boolean).join(";");
    const innerInlineStyle = [`color:${text}`].join(";");
    function buildFrameSVG(shape) {
      const gId = "g-" + (Math.random() + "").slice(2, 8);
      const stroke = title.borderColor || "#8b5cf6";
      switch (shape || "classic") {
        case "solid":
        case "double":
        case "dashed":
        case "dotted":
        case "custom":
        case "classic":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 72" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="10" y="10" width="200" height="52" rx="20" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M24 22 H84" stroke="rgba(255,255,255,.28)" stroke-width="4" stroke-linecap="round"/><path d="M24 50 H84" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/></svg>`;
        case "rectangle":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="10" y="10" width="200" height="50" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M20 22 H90" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/></svg>`;
        case "capsule":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 58" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="8" y="10" width="204" height="38" rx="20" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M32 22 H88" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/></svg>`;
        case "ribbon":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".5"/></linearGradient></defs><path d="M10 18 H210 Q214 18 214 22 V42 Q214 46 210 46 H10 Q6 46 6 42 V22 Q6 18 10 18 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M10 18 L2 28 L10 38" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M210 18 L218 28 L210 38" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/></svg>`;
        case "banner":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 74" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".5"/></linearGradient></defs><path d="M10 22 H210 Q214 22 214 26 V46 Q214 50 210 50 H10 Q6 50 6 46 V26 Q6 22 10 22 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M10 22 L0 34 L10 46" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M210 22 L220 34 L210 46" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/></svg>`;
        case "shield":
          return `<svg class="ts-frame-svg" viewBox="0 0 240 96" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".98"/><stop offset="0.4" stop-color="${gradTo || stroke}" stop-opacity=".78"/><stop offset="1" stop-color="${stroke}" stop-opacity=".58"/></linearGradient><linearGradient id="${gId}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.32)"/><stop offset=".5" stop-color="rgba(255,255,255,.06)"/><stop offset="1" stop-color="rgba(0,0,0,.18)"/></linearGradient><radialGradient id="${gId}c" cx="50%" cy="35%" r="45%"><stop offset="0" stop-color="rgba(255,255,255,.28)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient><filter id="fsh${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#fsh${gId})" d="M18 10 H222 L222 54 C222 70 200 84 176 90 L148 96 C138 100 130 96 120 96 C110 96 102 100 92 96 L64 90 C40 84 18 70 18 54 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.4"/><path d="M32 18 H208 L208 52 C208 65 190 77 168 83 L148 88 C138 91 130 88 120 88 C110 88 102 91 92 88 L72 83 C50 77 32 65 32 52 Z" fill="url(#${gId}b)" opacity=".55"/><ellipse cx="120" cy="46" rx="80" ry="36" fill="url(#${gId}c)" opacity=".6"/><line x1="26" y1="52" x2="214" y2="52" stroke="rgba(255,255,255,.2)" stroke-width="1.4"/><line x1="120" y1="18" x2="120" y2="86" stroke="rgba(255,255,255,.12)" stroke-width="1.2"/><polygon points="120,30 130,42 120,54 110,42" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.5)" stroke-width="1.2"/><polygon points="120,34 127,42 120,50 113,42" fill="${gradTo || stroke}" opacity=".55"/><circle cx="50" cy="11" r="3.5" fill="rgba(255,255,255,.4)"/><circle cx="120" cy="10" r="4" fill="rgba(255,255,255,.5)"/><circle cx="190" cy="11" r="3.5" fill="rgba(255,255,255,.4)"/></svg>`;
        case "hexagon":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient></defs><polygon points="30,20 190,20 210,36 190,54 30,54 10,36" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M40 28 L80 28" stroke="rgba(255,255,255,.3)" stroke-width="4"/></svg>`;
        case "diamond":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient></defs><polygon points="110,10 200,36 110,60 20,36" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M110,14 L110,56" stroke="rgba(255,255,255,.2)" stroke-width="3"/></svg>`;
        case "dragon":
          return `<svg class="ts-frame-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset=".5" stop-color="${gradTo || stroke}" stop-opacity=".75"/><stop offset="1" stop-color="${stroke}" stop-opacity=".55"/></linearGradient><filter id="f${gId}"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#f${gId})" d="M14 70 L14 50 C14 44 18 38 24 34 L24 22 L30 14 L36 24 C42 18 50 14 60 16 L68 4 L74 18 C82 12 92 10 104 12 L110 2 L116 12 C128 8 140 10 152 14 L158 4 L164 18 C174 14 184 16 192 22 L198 10 L204 22 C212 26 220 32 222 40 L222 52 C222 62 218 68 212 70 L196 76 C186 80 176 72 166 76 L154 82 C144 78 134 74 120 78 L110 82 L100 78 C86 74 76 80 66 76 L50 70 C38 66 26 70 14 70 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.2"/><polygon points="120,30 126,38 120,46 114,38" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/></svg>`;
        case "scale":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 76" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".38"/></linearGradient><filter id="f-${gId}"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M14 54 L26 18 Q36 6 50 12 L64 6 Q76 22 92 10 L108 6 Q122 20 138 10 L154 6 Q168 22 184 14 L196 34 Q200 48 188 62 L170 70 Q154 56 142 72 L128 60 Q112 74 96 58 L82 72 Q66 56 54 70 L38 56 Q26 70 14 54 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2" filter="url(#f-${gId})"/></svg>`;
        case "flame":
          return `<svg class="ts-frame-svg ts-flame-anim-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#c81200"/><stop offset=".22" stop-color="#ff4500"/><stop offset=".5" stop-color="#ff8c00" stop-opacity=".95"/><stop offset=".78" stop-color="#ffda00" stop-opacity=".85"/><stop offset="1" stop-color="#fff8b0" stop-opacity=".55"/></linearGradient><filter id="fsharp${gId}"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path class="fl-outer" filter="url(#fsharp${gId})" d="M4 88 C4 88 4 72 6 62 C8 52 10 44 12 36 C14 28 14 14 20 20 C22 8 28 0 32 10 C36 2 42 0 46 8 C50 0 56 2 60 12 C64 2 70 0 74 8 C78 0 82 4 86 14 C90 4 96 0 100 10 C104 2 108 0 112 8 C114 2 118 0 120 6 C122 0 126 2 128 8 C132 0 136 0 140 10 C144 2 148 0 152 8 C156 0 160 4 164 14 C168 4 174 0 178 8 C182 2 186 0 190 10 C194 2 200 2 202 14 C206 6 210 8 214 22 C218 32 226 50 228 64 C230 74 236 88 236 88 Z" fill="url(#${gId})"/></svg>`;
        case "crystal":
          return `<svg class="ts-frame-svg" viewBox="0 0 240 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset=".35" stop-color="rgba(255,255,255,.55)"/><stop offset=".7" stop-color="${stroke}" stop-opacity=".6"/><stop offset="1" stop-color="${gradTo || stroke}" stop-opacity=".45"/></linearGradient><filter id="f${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M16 60 L8 36 L20 12 L36 4 L56 16 L80 6 L100 18 L120 4 L140 18 L160 6 L184 16 L204 4 L220 12 L232 36 L224 60 L204 72 L160 76 L120 78 L80 76 L36 72 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2" filter="url(#f${gId})"/><path d="M100 18 L120 30 L140 18 L120 4 Z" fill="rgba(255,255,255,.4)" stroke="rgba(255,255,255,.6)" stroke-width=".8"/><circle cx="36" cy="4" r="2.5" fill="rgba(255,255,255,.9)"/><circle cx="120" cy="4" r="3" fill="rgba(255,255,255,.95)"/><circle cx="204" cy="4" r="2.5" fill="rgba(255,255,255,.9)"/></svg>`;
        case "ghost":
          return `<svg class="ts-frame-svg" viewBox="0 0 200 64" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="rgba(255,255,255,.14)"/><stop offset="1" stop-color="rgba(255,255,255,.02)"/></linearGradient><filter id="f-${gId}"><feGaussianBlur stdDeviation="5" result="blur"/></filter></defs><path d="M0 42 Q10 20 24 24 Q36 12 52 22 Q64 10 78 18 Q92 6 106 18 Q122 8 134 20 Q148 12 162 26 Q176 18 188 30 Q196 38 200 46 L200 62 L0 62 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="1" opacity=".92" filter="url(#f-${gId})"/></svg>`;
        case "poison":
          return `<svg class="ts-frame-svg ts-poison-anim-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d4a1e"/><stop offset=".3" stop-color="#166534"/><stop offset=".6" stop-color="#15803d"/><stop offset="1" stop-color="#065f46"/></linearGradient><filter id="fsoft${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#fsoft${gId})" d="M12 66 L12 46 C12 36 14 28 20 22 C17 14 20 8 26 10 C30 6 36 8 38 14 C42 6 50 6 54 14 C58 6 66 8 70 16 C74 6 84 6 88 16 C92 6 100 8 104 16 C108 6 118 6 122 14 C126 8 132 8 136 16 C140 6 150 8 154 16 C158 6 168 6 172 14 C176 8 182 8 186 16 C190 8 198 10 200 20 C206 26 210 36 212 48 L212 64 L196 74 C182 80 166 70 152 76 L138 82 L122 74 C108 82 96 76 84 72 L70 78 L56 70 C44 78 30 72 18 66 Z" fill="url(#${gId})" stroke="#22c55e" stroke-width="1.8"/></svg>`;
        case "shadow":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#1e293b"/></linearGradient><radialGradient id="s-${gId}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="rgba(255,255,255,.1)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient></defs><path d="M10 20 C30 10 50 12 74 16 C96 20 114 12 134 18 C154 24 172 14 190 20 C206 24 214 34 216 48 L216 66 L4 66 L4 48 C6 34 14 28 30 22 Z" fill="url(#${gId})" stroke="rgba(255,255,255,.08)" stroke-width="1.4"/><ellipse cx="110" cy="40" rx="80" ry="28" fill="url(#s-${gId})" opacity=".32"/></svg>`;
        case "royal":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#ffeb9d"/><stop offset=".45" stop-color="#fbd155"/><stop offset="1" stop-color="#b5810d"/></linearGradient><radialGradient id="r-${gId}" cx="50%" cy="22%" r="22%"><stop offset="0" stop-color="rgba(255,255,255,.95)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient></defs><rect x="10" y="18" width="200" height="44" rx="22" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.5"/><rect x="28" y="24" width="164" height="32" rx="16" fill="rgba(255,255,255,.06)"/><circle cx="110" cy="40" r="12" fill="url(#r-${gId})" opacity=".92"/><path d="M110 30 L118 38 L110 46 L102 38 Z" fill="rgba(255,255,255,.4)"/></svg>`;
        case "arcane":
          return `<svg class="ts-frame-svg ts-arcane-glass" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6" stop-opacity=".9"/><stop offset="50%" stop-color="#d946ef" stop-opacity=".88"/><stop offset="100%" stop-color="#a855f7" stop-opacity=".85"/></linearGradient><filter id="arcane-blur-${gId}"><feGaussianBlur stdDeviation="6"/></filter></defs><rect x="8" y="12" width="204" height="46" rx="23" fill="url(#${gId})" filter="url(#arcane-blur-${gId})" opacity=".88"/><rect x="8" y="12" width="204" height="46" rx="23" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.5"/><rect x="20" y="20" width="180" height="30" rx="15" fill="rgba(255,255,255,.12)" opacity=".6"/><path d="M110 20 L118 35 L110 50 L102 35 Z" fill="rgba(255,255,255,.3)"/></svg>`;
        case "celestial":
          return `<svg class="ts-frame-svg" viewBox="0 0 220 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#f7fbff" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo}" stop-opacity=".4"/></linearGradient></defs><rect x="10" y="18" width="200" height="44" rx="22" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M100 12 L110 28 L126 34 L112 46 L116 62 L100 54 L84 62 L88 46 L74 34 L90 28 Z" fill="rgba(255,255,255,.26)"/><circle cx="38" cy="18" r="4.5" fill="rgba(255,255,255,.3)"/><circle cx="182" cy="18" r="4.5" fill="rgba(255,255,255,.3)"/><ellipse cx="110" cy="40" rx="76" ry="30" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.6"/></svg>`;
        default:
          return `<!-- no svg -->`;
      }
    }
    const pColors = { embers: "#f97316", smoke: "#9ca3af", mist: "#e0f2fe", stars: "#fde68a", bubbles: "#93c5fd", lightning: "#fbbf24", leaves: "#4ade80", snow: "#e2e8f0", sparkles: "#f0abfc" };
    let particlesHTML = "";
    if (title.particles && title.particles !== "none" && !opts.noParticles) {
      const pc = pColors[title.particles] || "#ffffff";
      const cnt = Math.max(2, Math.round((opts.small ? 3 : 5) * (1 + (rCfg.glowMul || 0) * 2)));
      let ph = "";
      for (let i = 0; i < cnt; i++) {
        const sz = (2 + Math.random() * (2 + (rCfg.glowMul || 0) * 3)).toFixed(1);
        const lft = 8 + Math.random() * 84;
        const dur = (0.9 + Math.random() * (1.4 - (rCfg.glowMul || 0))).toFixed(2);
        const dly = Math.random() * 1.6;
        const dx = (-10 + Math.random() * 20).toFixed(1);
        ph += `<span class="ts-particle" style="width:${sz}px;height:${sz}px;background:${pc};left:${lft}%;bottom:0;--ts-part-dur:${dur}s;--ts-part-delay:${dly}s;--ts-part-dx:${dx}px;box-shadow:0 0 6px ${pc}88;"></span>`;
      }
      particlesHTML = `<span class="ts-particle-host">${ph}</span>`;
    }
    let fxLayerHTML = "";
    if (title.effect && title.effect !== "none") {
      const eff = title.effect;
      let fxInner = "";
      if (eff === "embers") {
        const cnt = opts.small ? 4 : 7;
        for (let i = 0; i < cnt; i++) {
          const sz = (1.5 + Math.random() * 2.5).toFixed(1);
          const lft = (8 + Math.random() * 84).toFixed(0);
          const dur = (1 + Math.random() * 1.4).toFixed(2);
          const dly = (Math.random() * 2).toFixed(2);
          const dx = (-12 + Math.random() * 24).toFixed(1);
          fxInner += `<span class="ts-fx-ember" style="width:${sz}px;height:${sz}px;left:${lft}%;--edur:${dur}s;--edly:${dly}s;--edx:${dx}px;background:${glow};"></span>`;
        }
      } else if (eff === "runes") {
        const chars = ["\u16A6", "\u16A8", "\u16B1", "\u16B2", "\u16C9", "\u16CA", "\u16CF", "\u16D2", "\u16D6", "\u16D7", "\u16DA", "\u16DC"];
        fxInner = chars.slice(0, opts.small ? 4 : 6).join(" ");
      } else if (eff === "lightning") {
        const positions = [10, 26, 42, 58, 74, 90];
        ["\u26A1", "\u26A1", "\u26A1", "\u26A1", "\u26A1"].forEach((b, i) => {
          const dur = (0.7 + Math.random() * 0.6).toFixed(2);
          const dly = (Math.random() * 1.5).toFixed(2);
          fxInner += `<span class="ts-fx-bolt" style="left:${positions[i] || 20}%;--bdur:${dur}s;--bdly:${dly}s">${b}</span>`;
        });
      } else if (eff === "stars") {
        [{ x: 5, y: 50, sz: 10, dur: 4, dly: 0 }, { x: 88, y: 50, sz: 9, dur: 3.5, dly: 0.8 }, { x: 30, y: 10, sz: 8, dur: 5, dly: 1.4 }, { x: 68, y: 15, sz: 9, dur: 4.2, dly: 0.3 }, { x: 15, y: 80, sz: 7, dur: 3.8, dly: 2.1 }, { x: 82, y: 75, sz: 8, dur: 4.6, dly: 1 }].forEach((p) => {
          fxInner += `<span class="ts-fx-star" style="left:${p.x}%;top:${p.y}%;--sdur:${p.dur}s;--sdly:${p.dly}s;--ssz:${p.sz}px;--sox:${p.x}%;--soy:${p.y}%">\u2605</span>`;
        });
      } else if (eff === "drips") {
        [12, 28, 45, 60, 76, 90].forEach((lft) => {
          const dur = (1.6 + Math.random() * 1.4).toFixed(2);
          const dly = (Math.random() * 2).toFixed(2);
          fxInner += `<span class="ts-fx-drip" style="left:${lft}%;--ddur:${dur}s;--ddly:${dly}s;"></span>`;
        });
      }
      fxLayerHTML = `<span class="ts-fx-layer" aria-hidden="true">${fxInner}</span>`;
    }
    const _lid = "lg-" + (Math.random() + "").slice(2, 9);
    const _mid = "mb-" + (Math.random() + "").slice(2, 9);
    let rarityOverlayInner = "";
    if ((title.rarity || "").toLowerCase() === "legendary")
      rarityOverlayInner = `<svg class="ts-legendary-glint" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${_lid}" x1="0" x2="1"><stop offset="0" stop-color="rgba(255,255,255,0)"/><stop offset=".42" stop-color="rgba(255,255,255,0.72)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><rect x="0" y="0" width="100" height="100" fill="url(#${_lid})"/></svg>`;
    else if ((title.rarity || "").toLowerCase() === "mythic")
      rarityOverlayInner = `<svg class="ts-mythic-burst" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="${_mid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="rgba(255,220,255,0.95)"/><stop offset=".5" stop-color="rgba(255,120,200,0.35)"/><stop offset="1" stop-color="rgba(255,120,200,0)"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#${_mid})"/></svg>`;
    const rarityOverlay = rarityOverlayInner ? `<span class="ts-rarity-overlay-host">${rarityOverlayInner}</span>` : "";
    return `<span class="${wrapperClasses}" style="${wrapperInlineStyle}" title="${_esc(title.name || "")} (${_esc(title.rarity || "")})">` + buildFrameSVG(frameShape) + rarityOverlay + particlesHTML + fxLayerHTML + `<span class="ts-badge ts-badge-text" style="${innerInlineStyle}">${_esc(title.name || "Title")}</span></span>`;
  };
  console.log("[EduQuest] titles/badge-renderer.js loaded \u2014 tsBuildBadgeHTML registered. Leaderboard typeof guard now resolved.");

  // src/modules/leaderboard/hall-of-fame.js
  var HOL_CAT = {
    hall: { label: "Hall of Fame", icon: "\u{1F3DB}\uFE0F", color: "#ffd873", grad: "linear-gradient(135deg,#ffb95f,#d0bcff 55%,#4edea3)", glow: "rgba(255,216,115,.32)", beam: "rgba(255,255,255,.16)" },
    recitation: { label: "Recitation", icon: "\u{1F3A4}", color: "#4edea3", grad: "linear-gradient(135deg,#4edea3,#06b6d4)", glow: "rgba(78,222,163,.28)", beam: "rgba(78,222,163,.14)" },
    boss: { label: "Boss Raider", icon: "\u2694\uFE0F", color: "#EC4899", grad: "linear-gradient(135deg,#EC4899,#9333ea)", glow: "rgba(236,72,153,.3)", beam: "rgba(236,72,153,.16)" },
    academic: { label: "Academic", icon: "\u{1F4DA}", color: "#d0bcff", grad: "linear-gradient(135deg,#8b5cf6,#d0bcff)", glow: "rgba(139,92,246,.28)", beam: "rgba(139,92,246,.14)" },
    overall: { label: "Overall", icon: "\u{1F3C6}", color: "#ffb95f", grad: "linear-gradient(135deg,#ffb95f,#f97316)", glow: "rgba(255,185,95,.3)", beam: "rgba(255,185,95,.18)" }
  };
  var HOL_PERIODS = [
    { key: "all", label: "All Time" },
    { key: "monthly", label: "Monthly" },
    { key: "weekly", label: "Weekly" },
    { key: "daily", label: "Daily" }
  ];
  var HOL_PAGE_SIZE = 20;
  var _holPage = 1;
  var _holLastTabPeriodKey = "";
  var holGoToPage = function(page) {
    _holPage = Math.max(1, page | 0);
    window.renderLeaderboard(window._eqlActiveTab, window._eqlActivePeriod);
    const list = document.getElementById(`hol-list-${window._eqlActiveTab || "hall"}`);
    if (list) list.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  var holPrevPage = function() {
    window.holGoToPage(_holPage - 1);
  };
  var holNextPage = function() {
    window.holGoToPage(_holPage + 1);
  };
  function _holPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
    if (totalPages <= 1) {
      return `<div class="hol-page-range">Showing all ${totalCount}</div>`;
    }
    const nums = /* @__PURE__ */ new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
    const pages = Array.from(nums).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    let btns = "";
    let prevN = 0;
    pages.forEach((n) => {
      if (n - prevN > 1) btns += `<span class="hol-page-ellipsis">\u2026</span>`;
      btns += `<button class="hol-page-btn ${n === page ? "active" : ""}" onclick="holGoToPage(${n})">${n}</button>`;
      prevN = n;
    });
    return `
    <div class="hol-pagination">
      <button class="hol-page-btn" ${page <= 1 ? "disabled" : ""} onclick="holPrevPage()">\u2190 Prev</button>
      ${btns}
      <button class="hol-page-btn" ${page >= totalPages ? "disabled" : ""} onclick="holNextPage()">Next \u2192</button>
    </div>
    <div class="hol-page-range">Showing ${rangeStart}\u2013${rangeEnd} of ${totalCount}</div>`;
  }
  function _holPeriodResetAt(period) {
    if (period === "all") return null;
    const now = /* @__PURE__ */ new Date();
    if (period === "daily") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (period === "weekly") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (period === "monthly") {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return d.toISOString();
    }
    return null;
  }
  function _holGetTitleObj(student) {
    return typeof tsGetEquippedTitle === "function" ? tsGetEquippedTitle(student.id) : null;
  }
  function _holGetTitle(student, categoryKey) {
    const equipped = typeof tsGetEquippedTitle === "function" ? tsGetEquippedTitle(student.id) : null;
    if (equipped) return equipped.name;
    const unlocks = (AppStore.getSlice((s) => s.achievementUnlocks) || {})[student.id] || [];
    if (unlocks.length > 0) {
      const achList = AppStore.getSlice((s) => s.achievements) || [];
      const rarityOrder = ["Mythic", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
      for (const rarity of rarityOrder) {
        const ach = achList.find((a) => a.rarity === rarity && unlocks.some((u) => u.achId === a.id));
        if (ach) return ach.name;
      }
    }
    const tierTitles = {
      "Master": { overall: "Grand Master", boss: "Raid Legend", recitation: "Voice of Wisdom", academic: "Top Scholar" },
      "Scholar": { overall: "Scholar", boss: "Raid Veteran", recitation: "Silver Tongue", academic: "Bright Mind" },
      "Achiever": { overall: "Achiever", boss: "Raider", recitation: "Eager Speaker", academic: "Quest Seeker" },
      "Novice": { overall: "Novice", boss: "Recruit", recitation: "Rising Voice", academic: "Apprentice" }
    };
    const tier = student.tier || "Scholar";
    const catKey = categoryKey === "hall" ? "overall" : categoryKey;
    return (tierTitles[tier] || {})[catKey] || student.tier || "";
  }
  function _holBeamSVG(beamColor) {
    const cx = [25, 50, 75];
    const opacities = [0.55, 0.85, 0.45];
    const widths = [18, 26, 16];
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"
      style="position:absolute;inset:0;pointer-events:none;">
      <defs>
        <filter id="hol-blur"><feGaussianBlur stdDeviation="2.5"/></filter>
      </defs>
      ${cx.map((x, i) => `
      <polygon
        points="${x - widths[i] / 2},0 ${x + widths[i] / 2},0 ${x + widths[i]},100 ${x - widths[i]},100"
        fill="${beamColor}"
        opacity="${opacities[i]}"
        filter="url(#hol-blur)"
      />
      `).join("")}
    </svg>`;
  }
  function _holRenderCard(entry, rankNum, catKey, meta) {
    if (!entry) {
      return `<div class="hol-card rank${rankNum}" style="opacity:.3;padding-bottom:24px;">
        <div style="color:rgba(240,238,255,.25);font-family:var(--fm);font-size:11px;font-weight:800;letter-spacing:.08em;padding-top:20px;text-align:center;">#${rankNum}</div>
      </div>`;
    }
    const s = entry.student;
    const color = _cssColor2(s.color);
    const title = _holGetTitle(s, catKey);
    const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
    const portraitHtml = s.profilePic ? `<div class="hol-portrait" style="background:${color}22;border-color:${color}55;">
           <img src="${_esc2(s.profilePic)}" alt="${_esc2(s.name)}" onerror="this.parentElement.style.color='${color}';this.parentElement.innerHTML='<span class=&quot;hol-portrait-init&quot;>${_esc2(s.init)}</span>'">
         </div>` : `<div class="hol-portrait" style="background:${color}22;color:${color};border-color:${color}55;">
           <span class="hol-portrait-init">${_esc2(s.init)}</span>
         </div>`;
    const emberLefts = [10, 24, 40, 58, 74, 88];
    const secondaryLefts = [16, 38, 62, 84];
    const particleThemeClass = rankNum === 1 ? "hol-embers-fire" : rankNum === 2 ? "hol-embers-icy" : rankNum === 3 ? "hol-embers-bronze" : "";
    const particleLefts = rankNum === 1 ? emberLefts : secondaryLefts;
    const embersHtml = rankNum >= 1 && rankNum <= 3 ? `<div class="hol-embers ${particleThemeClass}">${particleLefts.map(
      (left, i) => `<span class="hol-ember" style="left:${left}%;animation-delay:${(i * 0.5).toFixed(1)}s;animation-duration:${(2.6 + i % 3 * 0.4).toFixed(1)}s"></span>`
    ).join("")}</div>` : "";
    const rankBadgeHtml = rankNum === 1 ? `<div class="hol-rank-badge hol-rank-badge-fire">1</div>` : `<div class="hol-rank-badge">${medals[rankNum - 1]}</div>`;
    const crownPalette = {
      1: { base: "#f59e0b", jewel: "#fde68a", side: "#fbbf24", band: "#d97706", glow: "rgba(249,115,22,.7)" },
      2: { base: "#cbd5e1", jewel: "#f8fafc", side: "#e2e8f0", band: "#64748b", glow: "rgba(203,213,225,.65)" },
      3: { base: "#cd7f32", jewel: "#fbcf9d", side: "#e3a35c", band: "#92400e", glow: "rgba(205,127,50,.65)" }
    };
    const cp = crownPalette[rankNum];
    const crownHtml = cp ? `
      <div class="hol-crown-wrap${rankNum !== 1 ? " hol-crown-wrap-sm" : ""}" style="--hol-crown-glow:${cp.glow}">
        <svg viewBox="0 0 46 34" fill="none" xmlns="http://www.w3.org/2000/svg" width="${rankNum === 1 ? 46 : 38}" height="${rankNum === 1 ? 34 : 28}" overflow="visible">
          <path d="M3 29 L10 8 L23 18 L36 8 L43 29 Z" fill="${cp.base}" stroke="${cp.side}" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="3"  cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="43" cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="23" cy="8"  r="3" fill="${cp.jewel}"/>
          <circle cx="10" cy="8"  r="2.2" fill="${cp.side}"/>
          <circle cx="36" cy="8"  r="2.2" fill="${cp.side}"/>
          <rect x="1.5" y="28.5" width="42" height="4.2" rx="1.8" fill="${cp.band}"/>
        </svg>
      </div>` : "";
    const displayName = s.displayName || s.name;
    const firstName = displayName.split(" ")[0];
    const titleObj = _holGetTitleObj(s);
    const titleDisplayHTML = titleObj && typeof tsBuildBadgeHTML === "function" ? `<div class="hol-card-title">${tsBuildBadgeHTML(titleObj, { noParticles: true })}</div>` : title ? `<div class="hol-card-title" style="--hol-title-color:${color}88">${_esc2(title)}</div>` : "";
    return `<div class="hol-card rank${rankNum}" title="${_esc2(displayName)}" style="">
      ${embersHtml}
      <div class="hol-portrait-wrap">
        ${portraitHtml}
        ${crownHtml}
        ${rankBadgeHtml}
      </div>
      <div class="hol-card-name">${_esc2(firstName)}</div>
      <div class="hol-card-score" style="color:${meta.color}">${entry.scoreLabel}</div>
      <div class="hol-card-score-lbl">${catKey === "boss" ? "damage" : catKey === "recitation" ? "points" : catKey === "hall" ? "experience" : "score"}</div>
      ${titleDisplayHTML}
    </div>`;
  }
  function _holRenderStage(entries, catKey, periodKey, myEntry) {
    const meta = HOL_CAT[catKey] || HOL_CAT.overall;
    const periodLabel = (HOL_PERIODS.find((p) => p.key === periodKey) || HOL_PERIODS[0]).label;
    const isHall = catKey === "hall";
    const slots = [entries[1], entries[0], entries[2]];
    const ranks = [2, 1, 3];
    const myRank = myEntry ? `#${myEntry.rank}` : "\u2014";
    const myScore = myEntry ? myEntry.scoreLabel : "\u2014";
    const myName = myEntry ? (myEntry.student.displayName || myEntry.student.name).split(" ")[0] : "You";
    const isInPodium = myEntry && myEntry.rank <= 3;
    const sparkleLefts = [4, 12, 20, 30, 38, 48, 58, 66, 74, 82, 90, 96];
    const sparkleHtml = isHall ? `<div class="hol-sparkle-field">${sparkleLefts.map((left, i) => {
      const size = 2 + i % 3;
      const top = 15 + i * 37 % 70;
      return `<span class="hol-sparkle" style="left:${left}%;top:${top}%;width:${size}px;height:${size}px;animation-delay:${(i * 0.55).toFixed(2)}s;animation-duration:${(4.5 + i % 4).toFixed(1)}s"></span>`;
    }).join("")}</div>` : "";
    return `<div class="hol-stage${isHall ? " hol-stage-legendary" : ""}">
      ${isHall ? '<div class="hol-legend-bar"></div>' : ""}
      ${sparkleHtml}
      <div class="hol-beams">${_holBeamSVG(meta.beam)}</div>
      <div class="hol-scene-header">
        <div class="hol-scene-kicker">${isHall ? "The Flagship Board" : "Hall of Legends"}</div>
        <div class="hol-scene-title" style="--hol-grad:${meta.grad};--hol-glow:${meta.glow}">${meta.icon} ${meta.label}</div>
        <div class="hol-scene-period">${isHall ? "Class-wide \xB7 All Activities" : periodLabel}</div>
      </div>

      <div class="hol-podium-row">
        ${slots.map((e, i) => _holRenderCard(e, ranks[i], catKey, meta)).join("")}
      </div>

      ${myEntry && !isInPodium ? `<div class="hol-my-rank-bar">
        <div>
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">Your Standing</div>
          <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc2(myName)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right">
            <div class="hol-my-rank-score" style="color:${meta.color}">${myScore}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">score</div>
          </div>
          <div style="text-align:center">
            <div class="hol-my-rank-num">${myRank}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">rank</div>
          </div>
        </div>
      </div>` : ""}
    </div>`;
  }
  function _holRenderHallSummary(entries) {
    const totalStudents = entries.length;
    const active = entries.filter((e) => e.score > 0).length;
    const totalXP = entries.reduce((a, e) => a + (e.score || 0), 0);
    const avgLevel = totalStudents ? Math.round(entries.reduce((a, e) => a + (e.student.level || 1), 0) / totalStudents) : 0;
    const masters = entries.filter((e) => e.student.tier === "Master").length;
    const cards = [
      { icon: "\u{1F393}", val: totalStudents.toLocaleString(), lbl: "Class Legends" },
      { icon: "\u2728", val: totalXP.toLocaleString(), lbl: "Combined XP" },
      { icon: "\u{1F4C8}", val: "Lv " + avgLevel, lbl: "Average Level" },
      { icon: "\u{1F451}", val: masters.toLocaleString(), lbl: "Grand Masters" }
    ];
    return `<div class="hol-hall-summary">
      ${cards.map((c) => `<div class="hol-summary-card">
        <div class="hol-summary-icon">${c.icon}</div>
        <div class="hol-summary-val">${c.val}</div>
        <div class="hol-summary-lbl">${c.lbl}</div>
      </div>`).join("")}
    </div>`;
  }
  function _holRenderRow(entry, catKey, meta, animDelay) {
    const { rank, student: s, stats, scoreLabel } = entry;
    const isMe = currentUser && s.id === currentUser.id;
    const color = _cssColor2(s.color);
    const title = _holGetTitle(s, catKey);
    let rowTint = "";
    if (rank === 1) rowTint = "top3-gold";
    else if (rank === 2) rowTint = "top3-silver";
    else if (rank === 3) rowTint = "top3-bronze";
    const avHtml = s.profilePic ? `<div class="hol-row-av" style="border-color:${color}44;background:${color}11;">
           <img src="${_esc2(s.profilePic)}" alt="${_esc2(s.name)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.style.background='${color}22';this.parentElement.style.color='${color}';this.parentElement.textContent='${_esc2(s.init)}'">
         </div>` : `<div class="hol-row-av" style="border-color:${color}44;background:${color}22;color:${color};">${_esc2(s.init)}</div>`;
    let sub = "";
    switch (catKey) {
      case "hall":
        sub = `\u2705 ${s.attendance || 0}% attendance \xB7 ${s.tier || "Novice"}`;
        break;
      case "recitation":
        sub = `\u{1F3A4} ${stats.sessionCount || 0} sessions \xB7 \u{1F525} ${stats.streak || 0} streak`;
        break;
      case "boss":
        sub = `\u2694\uFE0F ${stats.participationCount || 0} raids \xB7 \u{1F3C6} ${stats.victories || 0} victories`;
        break;
      case "academic":
        sub = `\u{1F4D6} ${stats.quizCount || 0} quests \xB7 \u2B50 ${stats.perfectScores || 0} perfect`;
        break;
      case "overall":
        sub = `XP ${(stats.baseXP || 0).toLocaleString()} \xB7 \u{1F3A4} ${stats.recitationPts || 0} pts`;
        break;
    }
    const rankLabel = rank === 1 ? "\u{1F451}" : rank === 2 ? "\u{1F948}" : rank === 3 ? "\u{1F949}" : rank;
    const titleObj = _holGetTitleObj(s);
    const titleLineHTML = titleObj && typeof tsBuildBadgeHTML === "function" ? `<div class="hol-row-title" style="margin-top:2px;display:flex;align-items:center">${tsBuildBadgeHTML(titleObj, { small: true, noParticles: true })}</div>` : title ? `<div class="hol-row-title" style="color:${color}88">${_esc2(title)}</div>` : "";
    return `<div class="hol-row ${rowTint} ${isMe ? "hol-me" : ""}"
      style="animation-delay:${animDelay}ms">
      <div class="hol-row-rank">${rankLabel}</div>
      ${avHtml}
      <div class="hol-row-info">
        <div class="hol-row-name">
          ${_esc2(s.displayName || s.name)}
          ${isMe ? '<span class="hol-row-badge-you">You</span>' : ""}
        </div>
        ${titleLineHTML}
        <div class="hol-row-sub">${sub}</div>
      </div>
      <div class="hol-row-score">
        <div class="hol-row-score-main" style="color:${meta.color}">${scoreLabel}</div>
        <div class="hol-row-score-lbl">${s.tier} \xB7 LV${s.level}</div>
      </div>
    </div>`;
  }
  function _holBuildNavBars(activeTab, activePeriod) {
    const cats = [
      { key: "hall", label: "Hall of Fame", icon: "\u{1F3DB}\uFE0F" },
      { key: "overall", label: "Overall", icon: "\u{1F3C6}" },
      { key: "recitation", label: "Recitation", icon: "\u{1F3A4}" },
      { key: "boss", label: "Boss Raider", icon: "\u2694\uFE0F" },
      { key: "academic", label: "Academic", icon: "\u{1F4DA}" }
    ];
    const catBar = `<div class="hol-cat-bar">
      ${cats.map((c) => `<button class="hol-cat-btn ${c.key === "hall" ? "hall-tab" : ""} ${activeTab === c.key ? "active" : ""}"
        onclick="renderLeaderboard('${c.key}','${activePeriod}')">
        <span class="hol-cat-icon">${c.icon}</span>${c.label}
      </button>`).join("")}
    </div>`;
    const periodBar = activeTab !== "hall" ? `<div class="hol-period-bar">
      ${HOL_PERIODS.map((p) => `<button class="hol-period-btn ${activePeriod === p.key ? "active" : ""}"
        onclick="renderLeaderboard('${activeTab}','${p.key}')">${p.label}</button>`).join("")}
    </div>` : "";
    return `<div class="hol-nav">${catBar}</div>${periodBar}`;
  }
  function _holTargetPageId() {
    const staff = typeof currentRole !== "undefined" && (currentRole === "admin" || currentRole === "teacher");
    return staff ? "a-hall-of-fame" : "s-leaderboard";
  }
  var renderLeaderboard = function(activeTab, activePeriod) {
    activeTab = activeTab || window._eqlActiveTab || "hall";
    activePeriod = activePeriod || window._eqlActivePeriod || "all";
    window._eqlActiveTab = activeTab;
    window._eqlActivePeriod = activePeriod;
    const tabPeriodKey = activeTab + "|" + activePeriod;
    if (tabPeriodKey !== _holLastTabPeriodKey) {
      _holPage = 1;
      _holLastTabPeriodKey = tabPeriodKey;
    }
    const isStaffViewer = typeof currentRole !== "undefined" && (currentRole === "admin" || currentRole === "teacher");
    const leaderboardConfig = AppStore.getSlice((s) => s.leaderboardConfig) || {};
    const cfg = leaderboardConfig[activeTab] || {};
    const enabled = cfg.enabled !== false;
    const meta = HOL_CAT[activeTab] || HOL_CAT.overall;
    const periodResetAt = _holPeriodResetAt(activePeriod);
    let entries = [];
    if (enabled) {
      const allStudents = AppStore.getSlice((s) => s.students) || [];
      const cache = {
        recitationLog: AppStore.getSlice((s) => s.recitationLog) || [],
        bossEvents: AppStore.getSlice((s) => s.bossEvents) || [],
        bossParticipants: AppStore.getSlice((s) => s.bossParticipants) || {},
        pointLog: AppStore.getSlice((s) => s.pointLog) || [],
        students: allStudents
      };
      entries = allStudents.map((student) => {
        let stats, score, scoreLabel;
        switch (activeTab) {
          case "hall": {
            stats = { xp: student.xp || 0, level: student.level || 1, tier: student.tier || "Novice", attendance: student.attendance || 0 };
            score = student.xp || 0;
            scoreLabel = score.toLocaleString() + " XP";
            break;
          }
          case "recitation": {
            stats = eqlComputeRecitation(student.id, periodResetAt, cache);
            score = stats.totalPts;
            scoreLabel = score.toLocaleString() + " pts";
            break;
          }
          case "boss": {
            stats = eqlComputeBoss(student.id, periodResetAt, cache);
            score = stats.totalDamage;
            scoreLabel = score.toLocaleString() + " DMG";
            break;
          }
          case "academic": {
            stats = eqlComputeAcademic(student.id, periodResetAt, cache);
            score = stats.academicXP + stats.perfectScores * 200 + stats.questCompletions * 50;
            scoreLabel = score.toLocaleString() + " pts";
            break;
          }
          default: {
            stats = eqlComputeOverall(student.id, periodResetAt, cache);
            score = stats.score;
            scoreLabel = score.toLocaleString() + " pts";
            break;
          }
        }
        return { student, stats, score, scoreLabel };
      });
      entries.sort((a, b) => b.score - a.score);
      let cr = 1;
      entries.forEach((e, i) => {
        if (i > 0 && entries[i - 1].score === e.score) e.rank = entries[i - 1].rank;
        else e.rank = cr;
        cr = e.rank + 1;
      });
    }
    const myEntry = entries.find((e) => currentUser && e.student.id === currentUser.id);
    const myRank = myEntry ? myEntry.rank : "\u2014";
    const active = entries.filter((e) => e.score > 0).length;
    const top3 = entries.slice(0, 3);
    const isHall = activeTab === "hall";
    const pg = document.getElementById(_holTargetPageId());
    if (!pg) return;
    pg.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-bg"></div>
      <div class="page-hero-bg2"></div>
      <div style="position:relative;z-index:1">
        <div class="page-hero-label">\u{1F3C6} Hall of Legends</div>
        <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${isHall ? "Class Rankings" : meta.label + " Rankings"}</h1>
        <p style="font-size:14px;color:var(--text-muted)">${isStaffViewer ? isHall ? "Where your class's legends are forged." : `See how your class stacks up in ${meta.label}.` : myEntry ? `Your rank: <span style="color:${meta.color};font-weight:700">#${myRank}</span>` : "Where legends are forged."}</p>
      </div>
    </div>

    ${_holBuildNavBars(activeTab, activePeriod)}

    ${!enabled ? `<div class="hol-disabled">
          <div style="font-size:44px;margin-bottom:14px">\u{1F512}</div>
          <div style="font-family:var(--fh);font-size:17px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Leaderboard Disabled</div>
          <div style="font-size:13px;color:var(--text-muted)">This leaderboard is currently turned off${isStaffViewer ? "." : " by your teacher."}</div>
         </div>` : entries.length < 1 ? `<div class="hol-empty">
            <div class="hol-empty-icon">${meta.icon}</div>
            <div class="hol-empty-title">No Data Yet</div>
            <div class="hol-empty-sub">Rankings will appear here as students participate. Be the first on the board!</div>
           </div>` : `
    ${_holRenderStage(top3, activeTab, activePeriod, myEntry)}

    ${isHall ? _holRenderHallSummary(entries) : ""}

    <div class="hol-list-header">
      <div class="hol-list-title">
        <span class="material-symbols-outlined" style="color:${meta.color};font-size:20px">format_list_numbered</span>
        Full Rankings
        <span class="hol-active-pill">${active} active</span>
      </div>
    </div>
    <div id="hol-list-${activeTab}">
      ${(() => {
      const rest = entries.filter((e) => e.rank > 3);
      const totalPages = Math.max(1, Math.ceil(rest.length / HOL_PAGE_SIZE));
      if (_holPage > totalPages) _holPage = totalPages;
      const start = (_holPage - 1) * HOL_PAGE_SIZE;
      const shown = rest.slice(start, start + HOL_PAGE_SIZE);
      return shown.map((e, i) => _holRenderRow(e, activeTab, meta, Math.min(i * 22, 200))).join("") + _holPagination(_holPage, totalPages, rest.length, rest.length ? start + 1 : 0, start + shown.length);
    })()}
    </div>`}`;
  };
  console.log("[HOL] hall-of-fame.js loaded. renderLeaderboard patched with HOL stage.");

  // build/bridges/hall-of-fame.bridge.js
  window.holGoToPage = holGoToPage;
  window.holPrevPage = holPrevPage;
  window.holNextPage = holNextPage;
  window.renderLeaderboard = renderLeaderboard;
})();
