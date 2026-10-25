(() => {
  // src/modules/core/state-manager.js
  var AppStore2 = (function() {
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
          AppStore2.syncFromLegacy(window.DB);
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

  // src/utils.js
  function _esc2(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // src/modules/achievements/ach_engine.js
  var ACH_RARITY = {
    Common: { color: "#9ca3af", glow: "rgba(156,163,175,0.2)", strip: "#6b7280" },
    Uncommon: { color: "#4ade80", glow: "rgba(74,222,128,0.2)", strip: "#22c55e" },
    Rare: { color: "#60a5fa", glow: "rgba(96,165,250,0.2)", strip: "#3b82f6" },
    Epic: { color: "#c084fc", glow: "rgba(192,132,252,0.2)", strip: "#9333ea" },
    Legendary: { color: "#fbbf24", glow: "rgba(251,191,36,0.3)", strip: "#f59e0b" },
    Mythic: { color: "#f472b6", glow: "rgba(244,114,182,0.3)", strip: "#ec4899" }
  };
  var ACH_RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  var achRarityClass = function(rarity) {
    return "ach-rarity-" + (rarity || "Common").toLowerCase();
  };
  var achBuildStats = function(student) {
    if (!student) return {};
    const sid = student.id;
    let bossVictories = 0, totalBossDmg = 0, totalCrits = 0, totalMinionsKilled = 0;
    Object.values(AppStore.getSlice((s) => s.bossParticipants) || {}).forEach((roster) => {
      const rec = roster[sid];
      if (rec) {
        totalBossDmg += rec.totalDamage || 0;
        totalCrits += rec.critHits || 0;
        totalMinionsKilled += rec.minionsDefeated || 0;
      }
    });
    const bossParticipants = AppStore.getSlice((s) => s.bossParticipants) || {};
    (AppStore.getSlice((s) => s.bossEvents) || []).forEach((boss, bi) => {
      if (boss.status === "ended" || boss.status === "loot") {
        const roster = bossParticipants[bi] || {};
        if (roster[sid] && (roster[sid].totalDamage || 0) > 0) bossVictories++;
      }
    });
    const redemptions = AppStore.getSlice((s) => s.redemptions) || [];
    const storePurchases = redemptions.filter((r) => r.studentId === sid).length;
    const totalCoinsSpent = redemptions.filter((r) => r.studentId === sid).reduce((a, r) => a + (r.pts || 0), 0);
    const attendancePresent = (AppStore.getSlice((s) => s.attendanceLogs) || []).filter((r) => r.studentId === sid && (r.status === "Early" || r.status === "On Time" || r.status === "Late")).length;
    let bestQuizScore = 0;
    const pointLog = AppStore.getSlice((s) => s.pointLog) || [];
    pointLog.filter((e) => e.studentId === sid && e.what && e.what.startsWith("Quest:")).forEach((e) => {
      const m = e.what.match(/\((\d+)%\)/);
      if (m) {
        const s = parseInt(m[1]);
        if (s > bestQuizScore) bestQuizScore = s;
      }
    });
    const recitationCount = (AppStore.getSlice((s) => s.recitationLog) || []).filter((r) => r.studentId === sid).length;
    const sorted = [...AppStore.getSlice((s) => s.students) || []].sort((a, b) => b.xp - a.xp);
    const liveRank = sorted.findIndex((s) => s.id === sid) + 1;
    let maxPerfectStreak = 0, currentPerfect = 0;
    [...pointLog].filter((e) => e.studentId === sid && e.what && e.what.startsWith("Quest:")).reverse().forEach((e) => {
      const m = e.what.match(/\((\d+)%\)/);
      if (m && parseInt(m[1]) >= 100) {
        currentPerfect++;
        if (currentPerfect > maxPerfectStreak) maxPerfectStreak = currentPerfect;
      } else currentPerfect = 0;
    });
    const completedIds = student.completedQuizzes || [];
    const chainsCompleted = typeof eqGetQuestChains === "function" ? eqGetQuestChains().filter((c) => c.quizzes.length && c.quizzes.every((q) => completedIds.includes(q.id))).length : 0;
    const questStreak = typeof computeQuestStreak === "function" ? computeQuestStreak(sid).current : 0;
    return {
      level: student.level || 0,
      xp: student.xp || 0,
      coins: student.coins || 0,
      attendance: student.attendance || 0,
      quizAvg: student.quizAvg || 0,
      quests_completed: (student.completedQuizzes || []).length,
      total_quests: (AppStore.getSlice((s) => s.quizzes) || []).length,
      boss_victories: bossVictories,
      boss_damage: totalBossDmg,
      boss_crits: totalCrits,
      minions_killed: totalMinionsKilled,
      store_purchases: storePurchases,
      coins_spent: totalCoinsSpent,
      attendance_present: attendancePresent,
      best_quiz_score: bestQuizScore,
      recitation_count: recitationCount,
      live_rank: liveRank,
      perfect_streak: maxPerfectStreak,
      student_count: sorted.length,
      quest_chains_completed: chainsCompleted,
      quest_streak: questStreak
    };
  };
  function achEvaluateTrigger(ach, stats) {
    if (!ach || !ach.triggerType || !ach.active) return false;
    const v = parseFloat(ach.triggerValue) || 0;
    switch (ach.triggerType) {
      case "level":
        return stats.level >= v;
      case "xp_earned":
        return stats.xp >= v;
      case "coins_earned":
        return stats.coins >= v;
      case "coins_spent":
        return stats.coins_spent >= v;
      case "quests_completed":
        return stats.quests_completed >= v;
      case "all_quests":
        return stats.total_quests > 0 && stats.quests_completed >= stats.total_quests;
      case "quiz_score":
        return stats.best_quiz_score >= v;
      case "quiz_avg":
        return stats.quizAvg >= v;
      case "perfect_streak":
        return stats.perfect_streak >= v;
      case "boss_victories":
        return stats.boss_victories >= v;
      case "boss_damage":
        return stats.boss_damage >= v;
      case "boss_crits":
        return stats.boss_crits >= v;
      case "minions_killed":
        return stats.minions_killed >= v;
      case "attendance_present":
        return stats.attendance_present >= v;
      case "attendance_pct":
        return stats.attendance >= v;
      case "store_purchases":
        return stats.store_purchases >= v;
      case "recitations":
        return stats.recitation_count >= v;
      case "top_rank":
        return stats.live_rank > 0 && stats.live_rank <= v;
      case "quest_chains_completed":
        return stats.quest_chains_completed >= v;
      case "quest_streak":
        return stats.quest_streak >= v;
      case "manual":
        return false;
      default:
        return false;
    }
  }
  var achCheckAndAward = function(studentId, suppressPopup) {
    _achCheckAndAwardCore(studentId, suppressPopup);
    AppStore.emit({ type: "achievements:check-and-award-ran", payload: { studentId, suppressPopup } });
  };
  function _achCheckAndAwardCore(studentId, suppressPopup) {
    if (!studentId) return;
    const student = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    if (!student) return;
    const stats = achBuildStats(student);
    const alreadyUnlocked = new Set(((AppStore.getSlice((s) => s.achievementUnlocks) || {})[studentId] || []).map((u) => u.achId));
    const sectionAssignments = AppStore.getSlice((s) => s.achievementSectionAssignments) || {};
    const myClassId = student.classId || "default-class";
    const newlyUnlocked = (AppStore.getSlice((s) => s.achievements) || []).filter((ach) => {
      if (!ach.active || alreadyUnlocked.has(ach.id)) return false;
      const assignedSections = sectionAssignments[ach.id];
      if (assignedSections && assignedSections.length > 0 && !assignedSections.includes(myClassId)) return false;
      return achEvaluateTrigger(ach, stats);
    });
    if (!newlyUnlocked.length) return;
    AppStore.updateState((draft) => {
      if (!draft.achievementUnlocks) draft.achievementUnlocks = {};
      if (!draft.achievementUnlocks[studentId]) draft.achievementUnlocks[studentId] = [];
      newlyUnlocked.forEach((ach) => {
        draft.achievementUnlocks[studentId].push({
          achId: ach.id,
          unlockedAt: (/* @__PURE__ */ new Date()).toISOString(),
          xpGranted: parseInt(ach.xpReward) || 0,
          coinsGranted: parseInt(ach.coinReward) || 0,
          claimed: false,
          claimedAt: null
        });
      });
    }, { type: "achievements:unlocked", payload: { studentId, achIds: newlyUnlocked.map((a) => a.id) } });
    newlyUnlocked.forEach((ach) => syncAchievementUnlockToServer(studentId, ach.id, 0, 0, false, myClassId));
    currentUser = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    achUpdateSidebarBadge();
    if (!suppressPopup) newlyUnlocked.forEach((ach, i) => setTimeout(() => achShowUnlockPopup(ach), i * 1400));
  }
  var achGrantRewardsForClaim = function(studentId, achId) {
    const existingUnlock = ((AppStore.getSlice((s) => s.achievementUnlocks) || {})[studentId] || []).find((u) => u.achId === achId);
    if (!existingUnlock || existingUnlock.claimed) return false;
    const xpGrant = parseInt(existingUnlock.xpGranted) || 0;
    const coinGrant = parseInt(existingUnlock.coinsGranted) || 0;
    const achName = (AppStore.getSlice((s) => s.achievements) || []).find((a) => a.id === achId)?.name || "Achievement";
    let updatedStudent = null;
    AppStore.updateState((draft) => {
      const s = (draft.students || []).find((x) => x.id === studentId);
      if (!s) return;
      s.xp = (s.xp || 0) + xpGrant;
      s.coins = (s.coins || 0) + coinGrant;
      const unlockRec = ((draft.achievementUnlocks || {})[studentId] || []).find((u) => u.achId === achId);
      if (unlockRec) {
        unlockRec.claimed = true;
        unlockRec.claimedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (xpGrant > 0 || coinGrant > 0) {
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({ id: "pl_" + uid(), studentId, what: `\u{1F3C5} Achievement Claimed: ${achName}`, pts: coinGrant || xpGrant, when: "Just now", createdAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      updatedStudent = s;
    }, { type: "achievements:claimed", payload: { studentId, achId } });
    if (!updatedStudent) return false;
    syncStudentStatsToServer(studentId, xpGrant, coinGrant);
    syncAchievementClaimToServer(studentId, achId, xpGrant, coinGrant);
    currentUser = updatedStudent;
    achUpdateSidebarBadge();
    updateTopbar();
    return { xp: xpGrant, coins: coinGrant };
  };
  var achUpdateSidebarBadge = function() {
    if (currentRole !== "student" || !currentUser) return;
    const unlocks = (AppStore.getSlice((s) => s.achievementUnlocks) || {})[currentUser.id] || [];
    const unclaimedCount = unlocks.filter((u) => !u.claimed).length;
    const btn = document.getElementById("nav-s-badges");
    if (!btn) return;
    let badge = btn.querySelector(".ach-nav-badge");
    if (unclaimedCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ach-nav-badge";
        badge.style.cssText = "margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)";
        btn.appendChild(badge);
      }
      badge.textContent = unclaimedCount > 99 ? "99+" : String(unclaimedCount);
    } else {
      if (badge) badge.remove();
    }
  };
  var achShowUnlockPopup = function(ach) {
    const rarity = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
    const existing = document.getElementById("ach-unlock-popup");
    if (existing) existing.remove();
    const d = document.createElement("div");
    d.id = "ach-unlock-popup";
    d.className = "ach-unlock-popup";
    d.style.cssText = `border-color:${rarity.color}55;box-shadow:0 8px 40px ${rarity.glow};cursor:pointer`;
    const hasRewards = (ach.xpReward || 0) > 0 || (ach.coinReward || 0) > 0;
    d.innerHTML = `
    <div class="ach-popup-icon">${ach.icon || "\u{1F3C5}"}</div>
    <div style="flex:1">
      <div class="ach-popup-title" style="color:${rarity.color}">\u2728 Achievement Unlocked!</div>
      <div class="ach-popup-name">${_esc(ach.name)}</div>
      <div class="ach-popup-rewards" style="color:var(--text-muted)">${hasRewards ? "Tap to claim rewards \u2192" : "View in Achievements"}</div>
    </div>
    <div style="width:8px;height:8px;border-radius:50%;background:${rarity.color};box-shadow:0 0 8px ${rarity.color};flex-shrink:0;margin-top:4px;animation:achBadgePulse 1.5s ease-in-out infinite"></div>`;
    d.addEventListener("click", () => {
      d.style.animation = "achPopOut .4s ease forwards";
      setTimeout(() => {
        d.remove();
        navTo("s-badges");
      }, 400);
    });
    document.body.appendChild(d);
    setTimeout(() => {
      if (d.parentNode) {
        d.style.animation = "achPopOut .4s ease forwards";
        setTimeout(() => d.remove(), 400);
      }
    }, 4500);
  };
  AppStore.subscribe("ach-engine-boss-damage", function(state, event) {
    if (event.type !== "world-boss:damage-applied" && event.type !== "world-boss:defeated") return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId) setTimeout(() => achCheckAndAward(studentId), 400);
  });
  AppStore.subscribe("ach-engine-session-booted", function(state, event) {
    if (event.type !== "session:booted") return;
    if (getCurrentRole() === "student" && getCurrentUser()) {
      setTimeout(() => achCheckAndAward(getCurrentUser().id), 400);
    }
  });
  console.log("[EduQuest] achievements/engine.js loaded \u2014 ACH_RARITY, achBuildStats, achCheckAndAward, achGrantRewardsForClaim, achUpdateSidebarBadge, achShowUnlockPopup registered. Trigger hooks patched.");
  AppStore.subscribe("ach-engine-state-sync", function(state, event) {
    const watchedEvents = [
      "recitation:logged",
      "loot:claimed",
      "xp:awarded",
      "state:legacy-sync",
      // Fills the gap left by the removed dead logAttendance patch — these are
      // the real, live events attendance-service.js emits for the two
      // attendance-based achievement trigger types (attendance_present,
      // attendance_pct). attendance:session-closed is deliberately NOT
      // watched: it's a bulk absence-sweep, and marking someone absent can
      // only decrease those stats, never newly cross an unlock threshold —
      // checking there would be a guaranteed no-op every time.
      "attendance:scan-recorded",
      "attendance:override"
    ];
    if (!watchedEvents.includes(event.type)) return;
    if (event.type === "attendance:scan-recorded" && event.payload && event.payload.alreadyRecorded) return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId && typeof achCheckAndAward === "function") {
      setTimeout(function() {
        achCheckAndAward(studentId, true);
      }, 400);
    }
    if (typeof achUpdateSidebarBadge === "function") achUpdateSidebarBadge();
  });
  AppStore.subscribe("ach-engine-quiz-finished", function(state, event) {
    if (event.type !== "quiz:finished") return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId && typeof achCheckAndAward === "function") {
      setTimeout(function() {
        achCheckAndAward(studentId);
      }, 500);
    }
  });

  // src/modules/achievements/ach_student_page.js
  var renderBadges = function() {
    const st = currentUser;
    if (!st) return;
    const unlocks = (AppStore2.getSlice((s) => s.achievementUnlocks) || {})[st.id] || [];
    const unlockedIds = new Set(unlocks.map((u) => u.achId));
    const sectionAssignments = AppStore2.getSlice((s) => s.achievementSectionAssignments) || {};
    const myClassId = st.classId || "default-class";
    const inMySection = (ach) => {
      const assigned = sectionAssignments[ach.id];
      return !assigned || assigned.length === 0 || assigned.includes(myClassId);
    };
    const allAchs = (AppStore2.getSlice((s) => s.achievements) || []).filter((a) => a.active && (inMySection(a) || unlockedIds.has(a.id)));
    const visibleAchs = allAchs.filter((a) => !a.isHidden || unlockedIds.has(a.id));
    const earned = allAchs.filter((a) => unlockedIds.has(a.id));
    const unclaimedAchs = earned.filter((a) => {
      const u = unlocks.find((x) => x.achId === a.id);
      return u && !u.claimed;
    });
    const claimedAchs = earned.filter((a) => {
      const u = unlocks.find((x) => x.achId === a.id);
      return u && u.claimed;
    });
    const completionPct = allAchs.length ? Math.round(earned.length / allAchs.length * 100) : 0;
    const rarityOrder = ["Mythic", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
    let rarestBadge = null;
    for (const r of rarityOrder) {
      const f = earned.find((a) => a.rarity === r);
      if (f) {
        rarestBadge = f;
        break;
      }
    }
    const activeFilter = window._achFilter || "all";
    const activeRarity = window._achRarityFilter || "all";
    const activeTab = window._achTab || "all";
    const searchQ = (window._achSearch || "").toLowerCase();
    let displayed = visibleAchs;
    if (activeFilter !== "all") displayed = displayed.filter((a) => a.category === activeFilter);
    if (activeRarity !== "all") displayed = displayed.filter((a) => a.rarity === activeRarity);
    if (searchQ) displayed = displayed.filter((a) => a.name.toLowerCase().includes(searchQ) || (a.description || "").toLowerCase().includes(searchQ));
    if (activeTab === "unclaimed") displayed = displayed.filter((a) => unclaimedAchs.some((u) => u.id === a.id));
    else if (activeTab === "claimed") displayed = displayed.filter((a) => claimedAchs.some((u) => u.id === a.id));
    else if (activeTab === "locked") displayed = displayed.filter((a) => !unlockedIds.has(a.id));
    const categories = [...new Set(allAchs.map((a) => a.category).filter(Boolean))];
    const catTabs = [{ key: "all", label: "All" }, ...categories.map((c) => ({ key: c, label: c }))];
    const rarityTabs = [{ key: "all", label: "All Rarities" }, ...ACH_RARITIES.map((r) => ({ key: r, label: r }))];
    document.getElementById("s-badges").innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div><div style="position:relative;z-index:1">
    <div class="page-hero-label">\u{1F3C5} Achievements</div>
    <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Your Achievements</h1>
    <p style="font-size:14px;color:var(--text-muted)"><span style="color:var(--tertiary);font-weight:700">${earned.length}</span> / ${allAchs.length} badges unlocked</p>
  </div></div>

  ${unclaimedAchs.length > 0 ? `
  <div style="background:linear-gradient(135deg,rgba(208,188,255,0.12),rgba(139,92,246,0.08));border:1px solid rgba(208,188,255,0.3);border-radius:16px;padding:18px 20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:44px;height:44px;border-radius:12px;background:rgba(208,188,255,0.15);border:1px solid rgba(208,188,255,0.3);display:flex;align-items:center;justify-content:center;font-size:22px;animation:achBadgePulse 2s ease-in-out infinite">\u{1F381}</div>
      <div>
        <div style="font-family:var(--fh);font-size:15px;font-weight:900;color:var(--primary)">${unclaimedAchs.length} Reward${unclaimedAchs.length > 1 ? "s" : ""} Ready to Claim</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Claim your achievement rewards before they expire!</div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="window._achTab='unclaimed';renderBadges()" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9)">\u{1F381} View Unclaimed</button>
  </div>` : ""}

  <div class="ach-stats-bar">
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--primary)">${earned.length}</div><div class="ach-stat-lbl">Earned</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:${unclaimedAchs.length > 0 ? "#EC4899" : "var(--secondary)"}"><span style="animation:${unclaimedAchs.length > 0 ? "achBadgePulse 2s ease-in-out infinite" : "none"};display:inline-block">${unclaimedAchs.length}</span></div><div class="ach-stat-lbl">Unclaimed</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--secondary)">${completionPct}%</div><div class="ach-stat-lbl">Completion</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val">${rarestBadge ? `<span style="font-size:18px">${rarestBadge.icon}</span>` : '<span style="color:var(--text-muted)">\u2014</span>'}</div><div class="ach-stat-lbl">Rarest Badge</div></div>
  </div>

  <!-- STATUS TABS -->
  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px;overflow-x:auto">
    ${[
      { key: "all", label: "All Badges", count: allAchs.length },
      { key: "unclaimed", label: "\u{1F381} Unclaimed", count: unclaimedAchs.length, accent: unclaimedAchs.length > 0 },
      { key: "claimed", label: "\u2705 Claimed", count: claimedAchs.length },
      { key: "locked", label: "\u{1F512} Locked", count: allAchs.length - earned.length }
    ].map((t) => `<button class="ach-filter-btn ${activeTab === t.key ? "active" : ""}" style="padding:10px 16px;border-radius:0;border-bottom:2px solid ${activeTab === t.key ? t.accent ? "#EC4899" : "var(--primary-dark)" : "transparent"};background:none;${activeTab === t.key && t.accent ? "color:#EC4899" : ""}" onclick="window._achTab='${t.key}';renderBadges()">
      ${t.label}${t.count > 0 ? ` <span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,.08);margin-left:4px">${t.count}</span>` : ""}
    </button>`).join("")}
  </div>

  <div class="section-header"><span class="material-symbols-outlined">workspace_premium</span><h2>Badge Collection</h2></div>
  <div class="ach-filter-bar">
    <input class="ach-search-input" type="text" placeholder="\u{1F50D} Search badges..." value="${_esc2(window._achSearch || "")}" oninput="window._achSearch=this.value;renderBadges()" style="max-width:200px">
    <div style="display:flex;gap:6px;flex-wrap:wrap">${catTabs.map((t) => `<button class="ach-filter-btn${activeFilter === t.key ? " active" : ""}" onclick="window._achFilter='${t.key}';renderBadges()">${_esc2(t.label)}</button>`).join("")}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${rarityTabs.map((t) => `<button class="ach-filter-btn${activeRarity === t.key ? " active" : ""}" style="font-size:10px" onclick="window._achRarityFilter='${t.key}';renderBadges()">${_esc2(t.label)}</button>`).join("")}</div>
  </div>

  ${displayed.length === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:60px 0;font-size:14px">No badges found for these filters.</div>' : ""}
  <div class="badges-grid">
    ${displayed.map((ach) => {
      const isUnlocked = unlockedIds.has(ach.id);
      const unlockRec = unlocks.find((u) => u.achId === ach.id);
      const isClaimed = unlockRec && unlockRec.claimed;
      const isUnclaimed = isUnlocked && !isClaimed;
      const rarity = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
      const isHiddenLocked = ach.isHidden && !isUnlocked;
      const rewardChips = ((ach.xpReward || 0) > 0 ? `<span class="ach-reward-chip" style="color:#c4b5fd;border-color:rgba(196,181,253,${isUnlocked ? "0.3" : "0.15"})">+${ach.xpReward} XP</span>` : "") + ((ach.coinReward || 0) > 0 ? `<span class="ach-reward-chip" style="color:#ffb95f;border-color:rgba(255,185,95,${isUnlocked ? "0.3" : "0.15"})">+${ach.coinReward} \u{1FA99}</span>` : "");
      return `<div class="ach-badge-card ${isUnclaimed ? "ach-unclaimed " : isUnlocked ? "" : "ach-locked " + (isHiddenLocked ? "ach-hidden-locked" : "")}" style="${isUnlocked ? `box-shadow:0 0 20px ${rarity.glow}${isUnclaimed ? ",0 0 0 2px " + rarity.color + "66" : ""};border-color:${rarity.color}${isUnclaimed ? "" : "44"}` : ""}" title="${isHiddenLocked ? "???" : _esc2(ach.description)}">
        <div class="ach-rarity-strip" style="background:${rarity.strip}"></div>
        ${isUnclaimed ? `<div class="ach-unclaimed-glow" style="background:radial-gradient(circle at 50% 0%,${rarity.color}22,transparent 70%)"></div>` : ""}
        <div class="ach-badge-icon-wrap">${isHiddenLocked ? "\u2753" : ach.icon || "\u{1F3C5}"}</div>
        <div class="ach-badge-title ${achRarityClass(ach.rarity)}">${isHiddenLocked ? "Hidden Achievement" : _esc2(ach.name)}</div>
        <span class="ach-rarity-tag ${achRarityClass(ach.rarity)}">${ach.rarity}</span>
        ${isHiddenLocked ? '<div class="ach-badge-desc">Complete certain actions to reveal...</div>' : `<div class="ach-badge-desc">${_esc2(ach.description || "")}</div>`}
        ${isUnclaimed ? `<div class="ach-unclaimed-label">\u{1F381} READY TO CLAIM</div>
             <div class="ach-reward-chips">${rewardChips}</div>
             <button class="ach-claim-btn" onclick="achClaimReward('${ach.id}')" style="background:linear-gradient(135deg,${rarity.strip},${rarity.color})">Claim Reward \u2192</button>` : isUnlocked ? `<div class="ach-unlocked-stamp">\u2713 CLAIMED ${new Date(unlockRec.claimedAt || unlockRec.unlockedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</div>
             <div class="ach-reward-chips">${rewardChips}</div>` : `<div class="ach-reward-chips">${rewardChips}</div>`}
      </div>`;
    }).join("")}
  </div>`;
    achUpdateSidebarBadge();
  };
  var achClaimReward = function(achId) {
    if (!currentUser || currentRole !== "student") return;
    const ach = (AppStore2.getSlice((s) => s.achievements) || []).find((a) => a.id === achId);
    if (!ach) return;
    const unlocks = (AppStore2.getSlice((s) => s.achievementUnlocks) || {})[currentUser.id] || [];
    const rec = unlocks.find((u) => u.achId === achId);
    if (!rec || rec.claimed) {
      toast("This achievement has already been claimed.", "#ffb4ab");
      return;
    }
    const _present = typeof eqRewardPresent === "function" ? eqRewardPresent : typeof window.eqRewardPresent === "function" ? window.eqRewardPresent : null;
    if (!_present) {
      achGrantRewardsForClaim(currentUser.id, achId);
      toast("\u{1F3C5} " + _esc2(ach.name) + " claimed!", "#d0bcff");
      window.renderBadges();
      return;
    }
    const rewards = [];
    if ((rec.xpGranted || 0) > 0) rewards.push({ type: "xp", amount: rec.xpGranted, icon: "\u26A1", label: "XP", color: "var(--primary)" });
    if ((rec.coinsGranted || 0) > 0) rewards.push({ type: "coins", amount: rec.coinsGranted, icon: "\u{1FA99}", label: "Coins", color: "var(--tertiary)" });
    const linkedTitle = (AppStore2.getSlice((s) => s.titles) || []).find((t) => t.achievementId === achId && t.active);
    if (linkedTitle) rewards.push({ type: "title", amount: 1, icon: linkedTitle.icon || "\u{1F396}\uFE0F", label: linkedTitle.name, color: "#EC4899", titleId: linkedTitle.id });
    const granted = achGrantRewardsForClaim(currentUser.id, achId);
    if (granted === false) return;
    if (linkedTitle && typeof tsUnlockTitleForStudent === "function") {
      tsUnlockTitleForStudent(currentUser.id, linkedTitle.id, false);
    }
    _present({
      title: "Achievement Claimed!",
      subtitle: ach.name,
      icon: ach.icon || "\u{1F3C5}",
      rarity: ach.rarity || "Common",
      source: "achievement",
      rewards,
      onClose: () => {
        window.renderBadges();
        if (typeof renderStudentDashboard === "function") renderStudentDashboard();
      }
    });
  };
  console.log("[EduQuest] achievements/student-page.js loaded \u2014 renderBadges, achClaimReward registered.");

  // build/bridges/ach_student_page.bridge.js
  window.renderBadges = renderBadges;
  window.achClaimReward = achClaimReward;
})();
