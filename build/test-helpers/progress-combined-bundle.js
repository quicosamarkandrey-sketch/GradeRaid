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

  // src/modules/recitation/progress.js
  var progress_exports = {};
  __export(progress_exports, {
    PROG_ATTENDANCE_MILESTONES: () => PROG_ATTENDANCE_MILESTONES,
    PROG_RECITATION_MILESTONES: () => PROG_RECITATION_MILESTONES,
    progActiveTab: () => progActiveTab,
    progAttStreak: () => progAttStreak,
    progBuildCalendar: () => progBuildCalendar,
    progCalMonth: () => progCalMonth,
    progCalNav: () => progCalNav,
    progCalYear: () => progCalYear,
    progGetAttendanceForStudent: () => progGetAttendanceForStudent,
    progGetRecitationsForStudent: () => progGetRecitationsForStudent,
    progPerfectMonths: () => progPerfectMonths,
    progRecStreak: () => progRecStreak,
    progRenderCalendarPanel: () => progRenderCalendarPanel,
    progRenderMilestones: () => progRenderMilestones,
    progRenderRecitationPanel: () => progRenderRecitationPanel,
    progRenderShowcase: () => progRenderShowcase,
    progRenderStreaks: () => progRenderStreaks,
    progShowCalDay: () => progShowCalDay,
    progSwitchTab: () => progSwitchTab,
    renderStudentProgress: () => renderStudentProgress
  });

  // src/pull-mappers.js
  var _HISTORY_LIMITS = {
    point_log: 500,
    redemptions: 300,
    recitation_log: 300,
    attendance_logs: 500,
    mail_messages: 300,
    orders: 300,
    quiz_history: 500,
    notifications: 100
  };
  function _deriveStudents(profilesData, quizHistoryByStudent) {
    const qh = quizHistoryByStudent || {};
    return (profilesData || []).filter((p) => p.role === "student").map((p) => ({
      id: p.id,
      pass: p.pass,
      name: p.display_name,
      init: p.init,
      color: p.color,
      xp: p.xp,
      coins: p.coins,
      level: p.level,
      tier: p.tier,
      attendance: Number(p.attendance_pct) || 0,
      quizAvg: Number(p.quiz_avg) || 0,
      firstName: p.first_name,
      lastName: p.last_name,
      displayName: p.display_name,
      profilePic: p.profile_pic_url,
      joinDate: p.join_date,
      classId: p.class_id || "default-class",
      // Phase 63 completedQuizzes — built from the already-shaped
      // quizHistoryByStudent map (id: [{quizId, aborted, ...}]) rather
      // than raw quiz_history rows, so this same function works whether
      // the caller just did a fresh quiz_history pull (full pull) or is
      // reusing the existing cached quizHistory slice unchanged (scoped
      // 'profiles' group refresh, where quiz_history itself didn't change).
      completedQuizzes: Array.from(new Set(
        (qh[p.id] || []).filter((h) => !h.aborted).map((h) => h.quizId)
      ))
    }));
  }
  function _deriveAdmin(profilesData, previousAdmin) {
    const adminRow = (profilesData || []).find((p) => p.role === "admin" || p.role === "teacher");
    return adminRow ? {
      id: adminRow.id,
      name: adminRow.display_name,
      role: "Teacher",
      pass: previousAdmin?.pass ?? (typeof DEFAULT_DB !== "undefined" ? DEFAULT_DB.admin?.pass : "admin123")
    } : previousAdmin ?? (typeof DEFAULT_DB !== "undefined" ? DEFAULT_DB.admin : null);
  }
  function _deriveEquippedTitles(profilesData) {
    const equippedTitles = {};
    (profilesData || []).forEach((p) => {
      if (p.role === "student" && p.equipped_title_id) equippedTitles[p.id] = p.equipped_title_id;
    });
    return equippedTitles;
  }
  function _deriveBossEvents(bossEventsData, lootClaimsData) {
    const bossIdById = {};
    const bossEventsArr = (bossEventsData || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((b, idx) => {
      bossIdById[b.id] = idx;
      return {
        _id: b.id,
        // kept so writes can map back; never read by legacy code
        classId: b.class_id || "default-class",
        // Phase 14: section ownership
        name: b.name,
        description: b.description,
        image: b.image,
        maxHp: b.max_hp,
        currentHp: b.current_hp,
        status: b.status,
        startDate: b.start_date,
        endDate: b.end_date,
        defeatedAt: b.defeated_at ? Date.parse(b.defeated_at) : null,
        // Phase 26: was raw string, unlike its sibling timestamps
        endedAt: b.ended_at ? Date.parse(b.ended_at) : null,
        // Phase 24: was local-only before
        xpReward: b.xp_reward,
        coinReward: b.coin_reward,
        participationReward: b.participation_reward,
        victoryReward: b.victory_reward,
        defeatNarrTitle: b.defeat_narr_title,
        defeatNarrText: b.defeat_narr_text,
        victoryTitle: b.victory_title,
        victoryMessage: b.victory_message,
        lootRewards: b.loot_rewards || [],
        lootDuration: b.loot_duration_sec,
        lootStartedAt: b.loot_started_at ? Date.parse(b.loot_started_at) : null,
        lootFinalizedAt: b.loot_finalized_at ? Date.parse(b.loot_finalized_at) : null,
        // Phase 46: advanced admin-config fields — previously never left
        // the browser tab that set them (see phase46_boss_advanced_settings_sync.sql
        // for the full story). Plain passthrough, same shape the modules
        // already read/write locally.
        bossQuestions: b.boss_questions || [],
        minionSettings: b.minion_settings || {},
        combatSettings: b.combat_settings || {},
        skills: b.skills || {},
        skillFireMode: b.skill_fire_mode || void 0,
        skillIntervalMin: b.skill_interval_min || void 0,
        skillIntervalMax: b.skill_interval_max || void 0,
        rageSettings: b.rage_settings || {},
        phases: b.phases || [],
        lootClaims: (lootClaimsData || []).filter((c) => c.boss_id === b.id).map((c) => ({
          id: c.id,
          rewardId: c.reward_id,
          itemName: c.item_name,
          rarity: c.rarity,
          studentId: c.student_id,
          claimedAt: Date.parse(c.claimed_at),
          classId: c.class_id || "default-class",
          // Phase 14: section ownership
          // Phase 44: claim_loot_reward() RPC now actually persists these —
          // restore them so the claim feed shows real names/colors after a
          // refresh instead of falling back to "Student" placeholders.
          studentName: c.student_name,
          studentInit: c.student_init,
          studentColor: c.student_color
        })),
        createdAt: b.created_at ? Date.parse(b.created_at) : null
      };
    });
    return { bossEventsArr, bossIdById };
  }
  function _deriveBossParticipants(bossParticipantsData, bossIdById) {
    const bossParticipantsObj = {};
    (bossParticipantsData || []).forEach((row) => {
      const idx = bossIdById[row.boss_id];
      if (idx === void 0) return;
      if (!bossParticipantsObj[idx]) bossParticipantsObj[idx] = {};
      bossParticipantsObj[idx][row.student_id] = {
        studentId: row.student_id,
        classId: row.class_id || "default-class",
        // Phase 14: section ownership
        totalDamage: row.total_damage,
        correctAnswers: row.correct_answers,
        wrongAnswers: row.wrong_answers,
        critHits: row.crit_hits,
        minionsDefeated: row.minions_defeated,
        joinTime: row.joined_at ? Date.parse(row.joined_at) : null,
        lastQIdx: row.last_question_idx
      };
    });
    return bossParticipantsObj;
  }
  function _deriveAchievements(achievementsData) {
    return (achievementsData || []).filter((a) => !a.is_starter_template).map((a) => ({
      id: a.id,
      ownerTeacherId: a.owner_teacher_id,
      // Phase 32: catalog owner scoping
      name: a.name,
      description: a.description,
      icon: a.icon,
      category: a.category,
      rarity: a.rarity,
      xpReward: a.xp_reward,
      coinReward: a.coin_reward,
      triggerType: a.trigger_type,
      triggerValue: a.trigger_value,
      active: a.active
    }));
  }
  function _deriveAchievementUnlocks(userAchievementsData) {
    const achievementUnlocks = {};
    (userAchievementsData || []).forEach((u) => {
      if (!achievementUnlocks[u.student_id]) achievementUnlocks[u.student_id] = [];
      achievementUnlocks[u.student_id].push({
        achId: u.achievement_id,
        unlockedAt: u.unlocked_at,
        xpGranted: u.xp_granted,
        coinsGranted: u.coins_granted,
        claimed: u.claimed,
        claimedAt: u.claimed_at,
        classId: u.class_id || "default-class"
        // Phase 14: section ownership
      });
    });
    return achievementUnlocks;
  }
  function _deriveTitles(titlesData) {
    return (titlesData || []).filter((t) => !t.is_starter_template).map((t) => ({
      id: t.id,
      ownerTeacherId: t.owner_teacher_id,
      // Phase 32: catalog owner scoping
      name: t.name,
      description: t.description,
      icon: t.icon,
      rarity: t.rarity,
      active: t.active !== false,
      achievementId: t.achievement_id,
      textColor: t.text_color,
      borderColor: t.border_color,
      glowColor: t.glow_color,
      bgColor: t.bg_color,
      primaryColor: t.primary_color,
      secondaryColor: t.secondary_color,
      gradientFrom: t.gradient_from,
      gradientTo: t.gradient_to,
      borderStyle: t.border_style,
      animation: t.animation,
      particles: t.particles,
      bgEffect: t.bg_effect,
      customBorderCSS: t.custom_border_css,
      customAnimationCSS: t.custom_animation_css,
      customBgCSS: t.custom_bg_css,
      createdAt: t.created_at,
      frameShape: t.frame_shape || "classic",
      frameStyle: t.frame_style || "none",
      accentColor: t.accent_color,
      effect: t.effect || "none",
      frameTemplate: t.frame_template || "solid"
    }));
  }
  function _deriveTitleUnlocks(titleUnlocksData) {
    const titleUnlocksObj = {};
    (titleUnlocksData || []).forEach((u) => {
      if (!titleUnlocksObj[u.student_id]) titleUnlocksObj[u.student_id] = [];
      titleUnlocksObj[u.student_id].push(u.title_id);
    });
    return titleUnlocksObj;
  }
  function _deriveTitleSectionAssignments(titleSectionsData) {
    const titleSectionAssignments = {};
    (titleSectionsData || []).forEach((row) => {
      if (!titleSectionAssignments[row.title_id]) titleSectionAssignments[row.title_id] = [];
      titleSectionAssignments[row.title_id].push(row.class_id);
    });
    return titleSectionAssignments;
  }
  function _deriveQuizzes(quizzesData) {
    return (quizzesData || []).filter((q) => !q.is_starter_template).map((q) => ({
      id: q.id,
      ownerTeacherId: q.owner_teacher_id,
      // Phase 32: catalog owner scoping
      title: q.title,
      desc: q.description,
      xpReward: q.xp_reward,
      coinReward: q.coin_reward,
      timeLimit: q.time_limit,
      rarity: q.rarity || "Common",
      cadence: q.cadence || "standing",
      chainId: q.chain_id || null,
      chainOrder: q.chain_order || 1,
      chainLabel: q.chain_label || "",
      startDate: q.start_date || null,
      endDate: q.end_date || null,
      stageTimers: Array.isArray(q.stage_timers) ? q.stage_timers : [null, null, null],
      questions: q.questions || [],
      active: q.active !== false,
      createdAt: q.created_at
    }));
  }
  function _deriveCampaignWorlds(campaignWorldsData) {
    return (campaignWorldsData || []).filter((w) => !w.is_starter_template).map((w) => ({
      id: w.id,
      ownerTeacherId: w.owner_teacher_id,
      // Phase 32: catalog owner scoping
      label: w.label,
      icon: w.icon,
      color: w.color,
      desc: w.description,
      stages: w.stages || []
    }));
  }
  function _deriveCampaignSectionAssignments(campaignStageSectionsData, campaignWorldsArr) {
    const worldIdByStageId = {};
    (campaignWorldsArr || []).forEach((w) => (w.stages || []).forEach((s) => {
      worldIdByStageId[s.id] = w.id;
    }));
    const campaignSectionAssignments = {};
    (campaignStageSectionsData || []).forEach((row) => {
      const worldId = worldIdByStageId[row.stage_id];
      if (!worldId) return;
      if (!campaignSectionAssignments[worldId]) campaignSectionAssignments[worldId] = [];
      if (!campaignSectionAssignments[worldId].includes(row.class_id)) campaignSectionAssignments[worldId].push(row.class_id);
    });
    return campaignSectionAssignments;
  }
  function _deriveMail(mailMessagesData, profilesData, titlesArr) {
    const mailByBatch = {};
    (mailMessagesData || []).forEach((row) => {
      const batchId = row.batch_id || row.id;
      if (!mailByBatch[batchId]) {
        const senderProfile = (profilesData || []).find((p) => p.id === row.sender_teacher_id);
        const rewards = [];
        if (row.xp_reward) rewards.push({ type: "xp", amount: row.xp_reward, icon: "\u26A1", label: "XP", color: "var(--primary)" });
        if (row.coin_reward) rewards.push({ type: "coins", amount: row.coin_reward, icon: "\u{1FA99}", label: "Coins", color: "var(--tertiary)" });
        if (row.title_reward_id) {
          const t = (titlesArr || []).find((x) => x.id === row.title_reward_id);
          rewards.push({ type: "title", amount: 1, icon: t && t.icon || "\u{1F396}\uFE0F", label: t && t.name || "Title", color: "#EC4899", titleId: row.title_reward_id });
        }
        mailByBatch[batchId] = {
          id: batchId,
          subject: row.subject,
          body: row.body,
          type: row.mail_type || "general",
          sender: senderProfile ? senderProfile.display_name : "Teacher",
          hasReward: !!(row.xp_reward || row.coin_reward || row.title_reward_id),
          rewards,
          to: [],
          sentAt: row.created_at,
          readBy: {},
          claimedBy: {},
          rowIdBySid: {}
        };
      }
      mailByBatch[batchId].to.push(row.recipient_student_id);
      mailByBatch[batchId].readBy[row.recipient_student_id] = !!row.read;
      mailByBatch[batchId].claimedBy[row.recipient_student_id] = !!row.claimed;
      mailByBatch[batchId].rowIdBySid[row.recipient_student_id] = row.id;
    });
    return Object.values(mailByBatch);
  }
  function _deriveQuizSectionAssignments(quizSectionsData) {
    const quizSectionAssignments = {};
    (quizSectionsData || []).forEach((row) => {
      if (!quizSectionAssignments[row.quiz_id]) quizSectionAssignments[row.quiz_id] = [];
      quizSectionAssignments[row.quiz_id].push(row.class_id);
    });
    return quizSectionAssignments;
  }
  function _deriveAchievementSectionAssignments(achievementSectionsData) {
    const achievementSectionAssignments = {};
    (achievementSectionsData || []).forEach((row) => {
      if (!achievementSectionAssignments[row.achievement_id]) achievementSectionAssignments[row.achievement_id] = [];
      achievementSectionAssignments[row.achievement_id].push(row.class_id);
    });
    return achievementSectionAssignments;
  }
  function _deriveInventory(inventoryRowsData) {
    const inventoryByStudent = {};
    (inventoryRowsData || []).forEach((row) => {
      if (!inventoryByStudent[row.student_id]) inventoryByStudent[row.student_id] = [];
      inventoryByStudent[row.student_id].push({
        itemId: row.item_id,
        itemName: row.item_name,
        emoji: row.emoji,
        category: row.category,
        quantity: row.quantity,
        datePurchased: row.date_purchased,
        lastPurchased: row.last_purchased,
        source: row.source,
        status: row.status,
        usedAt: row.used_at
      });
    });
    return inventoryByStudent;
  }
  function _deriveQuizHistory(quizHistoryRowsData) {
    const quizHistoryByStudent = {};
    const completedQuizzesByStudent = {};
    (quizHistoryRowsData || []).forEach((row) => {
      if (!quizHistoryByStudent[row.student_id]) quizHistoryByStudent[row.student_id] = [];
      quizHistoryByStudent[row.student_id].push({
        id: row.id,
        quizId: row.quiz_id,
        score: row.score,
        attempt: row.attempt,
        completedAt: row.completed_at,
        date: row.date_label,
        results: Array.isArray(row.question_results) ? row.question_results : void 0,
        aborted: !!row.aborted
      });
      if (!row.aborted) {
        if (!completedQuizzesByStudent[row.student_id]) completedQuizzesByStudent[row.student_id] = /* @__PURE__ */ new Set();
        completedQuizzesByStudent[row.student_id].add(row.quiz_id);
      }
    });
    return { quizHistoryByStudent, completedQuizzesByStudent };
  }
  function _deriveStudentSkills(studentSkillRowsData) {
    const studentSkillsObj = {};
    (studentSkillRowsData || []).forEach((row) => {
      studentSkillsObj[row.student_id] = {
        hint: row.hint_count || 0,
        heal: row.heal_count || 0,
        shield: row.shield_count || 0
      };
    });
    return studentSkillsObj;
  }
  function _derivePointLog(pointLogData) {
    return (pointLogData || []).map((p) => ({
      id: p.id,
      studentId: p.student_id,
      what: p.what,
      pts: p.pts,
      when: p.when_label,
      createdAt: p.created_at
    }));
  }
  function _deriveRedemptions(redemptionsData) {
    return (redemptionsData || []).map((r) => ({
      orderId: r.order_id,
      studentId: r.student_id,
      itemId: r.item_id,
      itemName: r.item_name,
      emoji: r.emoji,
      item: r.item_label,
      pts: r.pts,
      date: r.date_label,
      time: r.time_label,
      claimCode: r.claim_code,
      createdAt: r.created_at
    }));
  }
  function _deriveOrders(ordersData) {
    return (ordersData || []).map((o) => ({
      orderId: o.order_id,
      claimCode: o.claim_code,
      studentId: o.student_id,
      studentName: o.student_name,
      studentInit: o.student_init,
      studentColor: o.student_color,
      itemId: o.item_id,
      itemName: o.item_name,
      emoji: o.emoji,
      cost: o.cost,
      category: o.category,
      status: o.status,
      createdAt: o.created_at,
      createdDateStr: o.created_date_str,
      claimedAt: o.claimed_at ? Date.parse(o.claimed_at) : null,
      claimedBy: o.claimed_by,
      cancelledAt: o.cancelled_at ? Date.parse(o.cancelled_at) : null,
      cancelReason: o.cancel_reason,
      cancelledBy: o.cancelled_by
    }));
  }
  function _deriveNotifications(notificationsData) {
    return (notificationsData || []).map((n) => ({
      id: n.id,
      studentId: n.student_id,
      type: n.type,
      icon: n.icon,
      title: n.title,
      body: n.body,
      action: n.action,
      pts: n.pts,
      sourceId: n.source_id,
      read: n.read,
      createdAt: n.created_at
    }));
  }
  function _deriveRecitationLog(recitationLogData) {
    return (recitationLogData || []).map((r) => ({
      id: r.id,
      studentId: r.student_id,
      pts: r.pts,
      note: r.note,
      when: r.when_label,
      classId: r.class_id || null,
      createdAt: r.created_at || null
    }));
  }
  function _deriveRecitationSessions(recitationSessionsData) {
    return (recitationSessionsData || []).map((s) => ({
      id: s.id,
      classId: s.class_id,
      startedBy: s.started_by,
      startedAt: s.started_at,
      endedAt: s.ended_at || null,
      isActive: !!s.is_active
    }));
  }
  function _deriveRfidCards(rfidCardsData) {
    return (rfidCardsData || []).map((c) => ({
      id: c.id,
      tagId: c.tag_id,
      studentId: c.student_id,
      isActive: c.is_active,
      assignedAt: c.assigned_at,
      revokedAt: c.revoked_at
    }));
  }
  function _deriveAttendanceSchedules(attendanceSchedulesData) {
    return (attendanceSchedulesData || []).map((s) => ({
      id: s.id,
      classId: s.class_id,
      dayOfWeek: s.day_of_week ?? 0,
      dayOff: !!s.day_off,
      openTime: s.open_time,
      startTime: s.start_time,
      lateCutoff: s.late_cutoff,
      closeTime: s.close_time,
      active: s.active
    }));
  }
  function _deriveAttendanceLogs(attendanceLogsData) {
    return (attendanceLogsData || []).map((a) => ({
      id: a.id,
      studentId: a.student_id,
      classId: a.class_id,
      logDate: a.log_date,
      status: a.status,
      scannedAt: a.scanned_at,
      entryMethod: a.entry_method,
      rfidTag: a.rfid_tag,
      recordedBy: a.recorded_by,
      notes: a.notes
    }));
  }
  function _deriveStore(shopProductsData) {
    return (shopProductsData || []).filter((p) => !p.is_starter_template).map((p) => ({
      id: p.id,
      ownerTeacherId: p.owner_teacher_id,
      name: p.name,
      emoji: p.emoji,
      desc: p.description,
      cat: p.category,
      cost: p.cost,
      stock: p.stock,
      active: p.active,
      addedAt: p.created_at
    }));
  }
  function _deriveRegistrations(registrationsData) {
    return (registrationsData || []).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)).map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      username: r.username,
      email: r.email,
      studentId: r.student_id_text,
      gradeLevel: r.grade_level,
      section: r.section,
      classId: r.class_id,
      // Phase 33
      status: r.status,
      submittedAt: r.submitted_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: r.reviewed_by,
      rejectionReason: r.rejection_reason,
      approvedStudentId: r.approved_student_id
    }));
  }

  // src/realtime-groups.js
  var _REALTIME_TABLE_GROUPS = {
    profiles: "profiles",
    boss_events: "raid",
    boss_participants: "raid",
    loot_claims: "raid",
    achievements: "achievements",
    user_achievements: "achievements",
    point_log: "pointLog",
    recitation_log: "recitationLog",
    rfid_cards: "rfidCards",
    attendance_logs: "attendanceLogs",
    mail_messages: "mail",
    quiz_sections: "quizSectionAssignments",
    achievement_sections: "achievementSectionAssignments",
    titles: "titles",
    title_unlocks: "titles",
    title_sections: "titles",
    quizzes: "quizzes",
    campaign_worlds: "campaign",
    campaign_stage_sections: "campaign",
    orders: "orders",
    inventory: "inventory",
    quiz_history: "quizHistory",
    notifications: "notifications",
    student_skills: "studentSkills",
    recitation_sessions: "recitationSessions"
    // Phase 71
  };
  var _REFRESH_GROUPS = {
    profiles: {
      fetch: async (client) => ({ profiles: await client.from("profiles").select("*") }),
      apply: (raw, cache) => ({
        students: _deriveStudents(raw.profiles.data, cache.quizHistory),
        admin: _deriveAdmin(raw.profiles.data, cache.admin),
        equippedTitles: _deriveEquippedTitles(raw.profiles.data)
      })
    },
    raid: {
      // The plan's documented stress case: a boss-event raid where up to 30
      // students trigger boss_participants/loot_claims changes in a tight
      // window. All three tables feed the same two cache keys, so they're
      // always fetched together — refreshing them separately would just
      // mean re-deriving bossEvents/bossParticipants 2-3x in a row for no
      // benefit.
      fetch: async (client) => {
        const [bossEvents, bossParticipants, lootClaims] = await Promise.all([
          client.from("boss_events").select("*"),
          client.from("boss_participants").select("*"),
          client.from("loot_claims").select("*")
        ]);
        return { bossEvents, bossParticipants, lootClaims };
      },
      apply: (raw) => {
        const { bossEventsArr, bossIdById } = _deriveBossEvents(raw.bossEvents.data, raw.lootClaims.data);
        return {
          bossEvents: bossEventsArr,
          bossParticipants: _deriveBossParticipants(raw.bossParticipants.data, bossIdById),
          _bossIdById: bossIdById
        };
      }
    },
    achievements: {
      fetch: async (client) => {
        const [achievements, userAchievements] = await Promise.all([
          client.from("achievements").select("*"),
          client.from("user_achievements").select("*")
        ]);
        return { achievements, userAchievements };
      },
      apply: (raw) => ({
        achievements: _deriveAchievements(raw.achievements.data),
        achievementUnlocks: _deriveAchievementUnlocks(raw.userAchievements.data)
      })
    },
    pointLog: {
      fetch: async (client) => ({
        pointLog: await client.from("point_log").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.point_log)
      }),
      apply: (raw) => ({ pointLog: _derivePointLog(raw.pointLog.data) })
    },
    recitationLog: {
      fetch: async (client) => ({
        recitationLog: await client.from("recitation_log").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.recitation_log)
      }),
      apply: (raw) => ({ recitationLog: _deriveRecitationLog(raw.recitationLog.data) })
    },
    rfidCards: {
      fetch: async (client) => ({ rfidCards: await client.from("rfid_cards").select("*") }),
      apply: (raw) => ({ rfidCards: _deriveRfidCards(raw.rfidCards.data) })
    },
    attendanceLogs: {
      fetch: async (client) => ({
        attendanceLogs: await client.from("attendance_logs").select("*").order("log_date", { ascending: false }).limit(_HISTORY_LIMITS.attendance_logs)
      }),
      apply: (raw) => ({ attendanceLogs: _deriveAttendanceLogs(raw.attendanceLogs.data) })
    },
    mail: {
      // Needs profiles alongside mail_messages purely to resolve sender
      // display names (see _deriveMail) — still just 2 tables instead of 27.
      // Title-reward lookups reuse the already-cached titles slice instead
      // of re-fetching titles too.
      fetch: async (client) => {
        const [mailMessages, profiles] = await Promise.all([
          client.from("mail_messages").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.mail_messages),
          client.from("profiles").select("*")
        ]);
        return { mailMessages, profiles };
      },
      apply: (raw, cache) => ({ mail: _deriveMail(raw.mailMessages.data, raw.profiles.data, cache.titles) })
    },
    quizSectionAssignments: {
      fetch: async (client) => ({ quizSections: await client.from("quiz_sections").select("*") }),
      apply: (raw) => ({ quizSectionAssignments: _deriveQuizSectionAssignments(raw.quizSections.data) })
    },
    achievementSectionAssignments: {
      fetch: async (client) => ({ achievementSections: await client.from("achievement_sections").select("*") }),
      apply: (raw) => ({ achievementSectionAssignments: _deriveAchievementSectionAssignments(raw.achievementSections.data) })
    },
    titles: {
      // titles + title_unlocks + title_sections grouped together: unlocking
      // or re-scoping a title routinely touches more than one of these at
      // once, and all three only ever feed the "titles domain" of the cache.
      fetch: async (client) => {
        const [titles, titleUnlocks, titleSections] = await Promise.all([
          client.from("titles").select("*"),
          client.from("title_unlocks").select("*"),
          client.from("title_sections").select("*")
        ]);
        return { titles, titleUnlocks, titleSections };
      },
      apply: (raw) => ({
        titles: _deriveTitles(raw.titles.data),
        titleUnlocks: _deriveTitleUnlocks(raw.titleUnlocks.data),
        titleSectionAssignments: _deriveTitleSectionAssignments(raw.titleSections.data)
      })
    },
    quizzes: {
      fetch: async (client) => ({ quizzes: await client.from("quizzes").select("*") }),
      apply: (raw) => ({ quizzes: _deriveQuizzes(raw.quizzes.data) })
    },
    campaign: {
      fetch: async (client) => {
        const [campaignWorlds, campaignStageSections] = await Promise.all([
          client.from("campaign_worlds").select("*").order("sort_order", { ascending: true }),
          client.from("campaign_stage_sections").select("*")
        ]);
        return { campaignWorlds, campaignStageSections };
      },
      apply: (raw) => {
        const campaignWorldsArr = _deriveCampaignWorlds(raw.campaignWorlds.data);
        return {
          stageMap: campaignWorldsArr,
          campaignSectionAssignments: _deriveCampaignSectionAssignments(raw.campaignStageSections.data, campaignWorldsArr)
        };
      }
    },
    orders: {
      fetch: async (client) => ({
        orders: await client.from("orders").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.orders)
      }),
      apply: (raw) => ({ orders: _deriveOrders(raw.orders.data) })
    },
    inventory: {
      fetch: async (client) => ({ inventory: await client.from("inventory").select("*") }),
      apply: (raw) => ({ inventory: _deriveInventory(raw.inventory.data) })
    },
    quizHistory: {
      fetch: async (client) => ({
        quizHistory: await client.from("quiz_history").select("*").order("completed_at", { ascending: false }).limit(_HISTORY_LIMITS.quiz_history)
      }),
      apply: (raw, cache) => {
        const { quizHistoryByStudent, completedQuizzesByStudent } = _deriveQuizHistory(raw.quizHistory.data);
        const students = (cache.students || []).map((s) => ({
          ...s,
          completedQuizzes: Array.from(completedQuizzesByStudent[s.id] || [])
        }));
        return { quizHistory: quizHistoryByStudent, students };
      }
    },
    notifications: {
      fetch: async (client) => ({
        notifications: await client.from("notifications").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.notifications)
      }),
      apply: (raw) => ({ notifications: _deriveNotifications(raw.notifications.data) })
    },
    studentSkills: {
      fetch: async (client) => ({ studentSkills: await client.from("student_skills").select("*") }),
      apply: (raw) => ({ studentSkills: _deriveStudentSkills(raw.studentSkills.data) })
    },
    // Phase 71 — cross-device "Start Recitation Session" sync.
    recitationSessions: {
      fetch: async (client) => ({ recitationSessions: await client.from("recitation_sessions").select("*") }),
      apply: (raw) => ({ recitationSessions: _deriveRecitationSessions(raw.recitationSessions.data) })
    }
  };

  // src/repository/table-sync.js
  var TableSyncRepository = (function() {
    "use strict";
    const _TABLE_SYNC_CONFIGS = [
      {
        // Profiles (students table) — folded into the generic engine in an
        // earlier session; every line of logic below is preserved VERBATIM
        // from the standalone block this replaced (same staff-session
        // double-check, same per-class-id chunking, same warn-not-throw per
        // chunk, same six-column RPC-ownership exclusion). See db-service.js's
        // own Refactoring Report entry for the full history of WHY each of
        // these exists — xp/coins/level/tier (adjust_student_stats RPC) and
        // attendance_pct/quiz_avg (sync_student_derived_stats RPC) are
        // deliberately never in `rows` below; this upsert only ever touches
        // identity/cosmetic columns.
        //
        // [Phase 5B] Now `deltaTracked` — this table's own log entry
        // originally flagged why it couldn't be, safely, with the engine as
        // it stood then: this upsert is chunked per class_id, and an
        // out-of-scope or RLS-rejected chunk WARNS AND CONTINUES rather than
        // throwing, specifically so one bad chunk can't abort every other
        // table's push this cycle — a blanket "the call didn't throw, so
        // clear everything" rule (right for a single-batch upsert) would have
        // cleared dirty ids for students in a chunk that just failed,
        // permanently losing their retry. That's what `_runTableSync()`'s
        // upsertRows-return-value contract (see its own comment) exists to
        // fix: `upsertRows` below now collects and returns exactly the ids
        // that landed in a chunk that DIDN'T error, so only those get
        // cleared. Tracked in AppStore via `watchFields` — see
        // _DELTA_TRACKED_SLICES' `profiles` entry — so an xp/coin/level
        // change (constant, via gameplay, and none of the RPC-owned columns
        // ever touch this upsert anyway) never dirties this table; only the
        // identity/cosmetic columns actually sent here do.
        table: "profiles",
        requiresStaffGate: true,
        getSource: (cache) => cache.students,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        deltaTracked: true,
        idField: "id",
        async upsertRows(client, source) {
          let isStaffSession = false;
          try {
            const { data: sessionData } = await client.auth.getSession();
            if (sessionData && sessionData.session) {
              isStaffSession = typeof currentUser !== "undefined" && currentUser && (currentUser.role === "admin" || currentUser.role === "teacher");
            }
          } catch (e) {
            console.warn("[DBService] profiles upsert: could not check session, skipping.", e);
            return;
          }
          if (!isStaffSession) return;
          const isAdmin = typeof currentUser !== "undefined" && currentUser && currentUser.role === "admin";
          let writableClassIds = null;
          if (!isAdmin) {
            const mySections = typeof AppStore !== "undefined" ? AppStore.getSlice((s) => s.classSections) || [] : [];
            if (mySections.length) {
              writableClassIds = new Set(
                mySections.filter(function(s) {
                  return s.adviserId === currentUser.id;
                }).map(function(s) {
                  return s.id;
                })
              );
            }
          }
          const allRows = source.map((s) => ({
            id: s.id,
            role: "student",
            display_name: s.name,
            init: s.init,
            color: s.color,
            first_name: s.firstName,
            last_name: s.lastName,
            profile_pic_url: s.profilePic,
            class_id: s.classId || "default-class"
          }));
          const rows = writableClassIds ? allRows.filter(function(r) {
            return writableClassIds.has(r.class_id);
          }) : allRows;
          const skipped = allRows.length - rows.length;
          if (skipped > 0) {
            console.warn("[DBService] profiles upsert: skipping " + skipped + " student(s) outside this session's advised section(s) \u2014 stale local cache, or a section/adviser reassignment since the last pull.");
          }
          const succeededIds = [];
          if (rows.length) {
            const byClass = {};
            rows.forEach(function(r) {
              (byClass[r.class_id] = byClass[r.class_id] || []).push(r);
            });
            for (const classId of Object.keys(byClass)) {
              const { error } = await client.from("profiles").upsert(byClass[classId], { onConflict: "id" });
              if (error) {
                console.warn('[DBService] profiles upsert rejected for class_id "' + classId + '" (' + byClass[classId].length + " student(s) \u2014 not staff for this section server-side, or it has no adviser yet):", error);
              } else {
                byClass[classId].forEach(function(r) {
                  succeededIds.push(r.id);
                });
              }
            }
          }
          return succeededIds;
        }
      },
      {
        // Boss events: upsert by internal _id (created server-side; a brand
        // new boss drafted offline has no _id yet, so it inserts and the
        // server assigns one on the next pull). See the per-row logic below
        // for the isNewRow-conditional field seeding (max_hp/current_hp,
        // lifecycle timestamps) and the retry-on-23502 stale-_id recovery —
        // both preserved verbatim from the original block.
        table: "boss_events",
        requiresStaffGate: true,
        getSource: (cache) => cache.bossEvents,
        hasRows: (src) => Array.isArray(src),
        async upsertRows(client, source) {
          for (const b of source) {
            try {
              const isNewRow = !b._id;
              const row = {
                id: b._id,
                class_id: b.classId || "default-class",
                // Phase 14
                name: b.name,
                description: b.description,
                image: b.image,
                start_date: b.startDate || null,
                end_date: b.endDate || null,
                xp_reward: b.xpReward,
                coin_reward: b.coinReward,
                participation_reward: b.participationReward,
                victory_reward: b.victoryReward,
                defeat_narr_title: b.defeatNarrTitle,
                defeat_narr_text: b.defeatNarrText,
                victory_title: b.victoryTitle,
                victory_message: b.victoryMessage,
                loot_rewards: b.lootRewards || [],
                loot_duration_sec: b.lootDuration || 120,
                // Phase 46: pure admin-config JSON blobs with no RPC of their
                // own, so this bulk upsert is their only write path.
                boss_questions: b.bossQuestions || [],
                minion_settings: b.minionSettings || {},
                combat_settings: b.combatSettings || {},
                skills: b.skills || {},
                skill_fire_mode: b.skillFireMode || null,
                skill_interval_min: b.skillIntervalMin || null,
                skill_interval_max: b.skillIntervalMax || null,
                rage_settings: b.rageSettings || {},
                phases: b.phases || []
              };
              if (isNewRow) {
                row.max_hp = b.maxHp || 1e4;
                row.current_hp = b.currentHp !== void 0 && b.currentHp !== null ? b.currentHp : row.max_hp;
              } else if (b.maxHp !== void 0 && b.maxHp !== null) {
                row.max_hp = b.maxHp;
              }
              if (isNewRow) {
                row.status = b.status;
                row.defeated_at = b.defeatedAt ? new Date(b.defeatedAt).toISOString() : null;
                row.ended_at = b.endedAt ? new Date(b.endedAt).toISOString() : null;
                row.loot_started_at = b.lootStartedAt ? new Date(b.lootStartedAt).toISOString() : null;
                row.loot_finalized_at = b.lootFinalizedAt ? new Date(b.lootFinalizedAt).toISOString() : null;
              }
              if (!row.id) delete row.id;
              let { error } = await client.from("boss_events").upsert(row, { onConflict: "id" });
              if (error && error.code === "23502") {
                row.max_hp = row.max_hp || b.maxHp || 1e4;
                row.current_hp = b.currentHp !== void 0 && b.currentHp !== null && b.currentHp > 0 ? b.currentHp : row.max_hp;
                row.status = row.status || b.status || "draft";
                row.defeated_at = row.defeated_at || (b.defeatedAt ? new Date(b.defeatedAt).toISOString() : null);
                row.ended_at = row.ended_at || (b.endedAt ? new Date(b.endedAt).toISOString() : null);
                row.loot_started_at = row.loot_started_at || (b.lootStartedAt ? new Date(b.lootStartedAt).toISOString() : null);
                row.loot_finalized_at = row.loot_finalized_at || (b.lootFinalizedAt ? new Date(b.lootFinalizedAt).toISOString() : null);
                ({ error } = await client.from("boss_events").upsert(row, { onConflict: "id" }));
              }
              if (error) throw error;
            } catch (e) {
              console.warn('[DBService] boss_events: skipping "' + (b.name || b._id || "unnamed") + '" this cycle \u2014', e);
            }
          }
        }
      },
      {
        // Boss participants: upsert the roster. Same defense-in-depth note as
        // profiles — RLS still restricts student-initiated writes to their own
        // row while the boss is active.
        // [Phase 5B] Fourth table converted to delta sync, and the first one
        // with a genuine second-actor-same-row clobber risk: combat damage is
        // ALREADY written through a scoped RPC (apply_boss_damage — see
        // combat-settings.js's wbcApplyDamage), atomically, per student, in
        // real time. But this whole-slice push ran on every save cycle
        // regardless — including every OTHER student's cached roster entries
        // for that boss, not just the caller's own. Two students fighting the
        // same boss concurrently: student B lands a hit (RPC updates B's row
        // on the server instantly), then student A's client — which hasn't
        // pulled B's update yet — saves for an unrelated reason and bulk-
        // pushed its whole local bossParticipants[bossIdx], including A's
        // STALE cached copy of B's row, silently reverting B's just-recorded
        // damage. Delta-scoping this closes that gap: A only ever re-pushes
        // rows IT dirtied, which under normal play is only A's own studentId
        // key (see minions.js/raid-flow.js/student-page.js — every
        // combat-side write path indexes bossParticipants[bossIdx] by
        // currentUser.id, never another student's).
        table: "boss_participants",
        getSource: (cache) => cache.bossParticipants,
        hasRows: (src, cache) => !!(src && cache._bossIdById),
        buildRows(source, cache) {
          const idToUuid = {};
          Object.keys(cache._bossIdById).forEach((uuid) => {
            idToUuid[cache._bossIdById[uuid]] = uuid;
          });
          const rows = [];
          Object.keys(source).forEach((idx) => {
            const bossUuid = idToUuid[idx];
            if (!bossUuid) return;
            const roster = source[idx];
            Object.keys(roster).forEach((studentId) => {
              const r = roster[studentId];
              rows.push({
                boss_id: bossUuid,
                student_id: studentId,
                class_id: r.classId || "default-class",
                // Phase 14
                total_damage: r.totalDamage || 0,
                correct_answers: r.correctAnswers || 0,
                wrong_answers: r.wrongAnswers || 0,
                crit_hits: r.critHits || 0,
                minions_defeated: r.minionsDefeated || 0,
                last_question_idx: r.lastQIdx || 0
              });
            });
          });
          return rows;
        },
        conflictKey: "boss_id,student_id",
        deltaTracked: true,
        // Composite bossIdx->studentId source needs its own filter — plain
        // idField can't express "dirty" for a two-level keyed object. Also
        // pre-checks boss-uuid resolvability (same check buildRows makes) so
        // every id returned here is guaranteed to produce a row — an
        // unresolved boss's dirty ids are simply left out (and so stay dirty
        // for a later cycle, once that boss has synced and gained a uuid)
        // rather than risk clearDirty() on an id buildRows silently dropped.
        deltaFilterSource(source, dirtySet, cache) {
          const idToUuid = {};
          Object.keys(cache._bossIdById || {}).forEach((uuid) => {
            idToUuid[cache._bossIdById[uuid]] = uuid;
          });
          const filtered = {};
          const ids = [];
          Object.keys(source).forEach((idx) => {
            if (!idToUuid[idx]) return;
            const roster = source[idx] || {};
            Object.keys(roster).forEach((studentId) => {
              const id = idx + ":" + studentId;
              if (dirtySet.has(id)) {
                if (!filtered[idx]) filtered[idx] = {};
                filtered[idx][studentId] = roster[studentId];
                ids.push(id);
              }
            });
          });
          return { source: filtered, ids };
        }
      },
      {
        // Shop products: per-teacher catalog (Phase 14). `stock` is
        // deliberately excluded — owned exclusively by purchase_shop_product()
        // / restock_shop_product() RPCs, so a plain overwrite here can't
        // clobber a purchase/restock that happened between pull and push.
        // [Phase 5B] Twelfth table converted to delta sync. Flat array,
        // client-generated id (uid(), assigned in shop_admin_store.js's
        // doAddProduct() at the same line as ownerTeacherId — verified
        // before converting). `stock` deliberately isn't in buildRows' output
        // at all ("local/display value only — see RPC call below" in the
        // original comment), so no watchFields scoping is needed here the
        // way profiles needed it — nothing this table's diff would react to
        // is excluded from its own payload.
        table: "shop_products",
        requiresStaffGate: true,
        getSource: (cache) => cache.store,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((p) => p.id && p.ownerTeacherId).map((p) => ({
          id: p.id,
          owner_teacher_id: p.ownerTeacherId,
          name: p.name,
          emoji: p.emoji,
          description: p.desc,
          category: p.cat,
          cost: p.cost,
          active: p.active !== false
        })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Achievements (the catalog — Phase 17). isHidden isn't a real column
        // today, stays local-only. user_achievements (per-student unlock/
        // claim rows) are NOT pushed from here — RPC-only, same reasoning as
        // loot_claims/registrations. Phase 32: owner_teacher_id required.
        //
        // [Phase 5B] Thirteenth table converted to delta sync. Same
        // reasoning as shop_products — client-generated id verified at
        // creation, and every field in buildRows' output is a catalog
        // definition column; per-student unlock/claim state is explicitly
        // out of scope for this push path (see comment above), so no
        // watchFields scoping is needed.
        table: "achievements",
        requiresStaffGate: true,
        getSource: (cache) => cache.achievements,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((a) => a.id && a.ownerTeacherId).map((a) => ({
          id: a.id,
          owner_teacher_id: a.ownerTeacherId,
          name: a.name,
          description: a.description,
          icon: a.icon,
          category: a.category,
          rarity: a.rarity,
          xp_reward: a.xpReward,
          coin_reward: a.coinReward,
          trigger_type: a.triggerType,
          trigger_value: a.triggerValue,
          active: a.active !== false
        })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Titles (the catalog — Phase 18). title_unlocks / equipped_title_id
        // are NOT pushed from here — RPC-only. Phase 32: owner required.
        // Phase 52: Designer v3 frame/style/accent/effect columns.
        // [Phase 5B] Seventh table converted to delta sync. Same reasoning as
        // redemptions/point_log: whole-row-replacement is fine here (a title
        // editor saves the full row at once), it just needs to be scoped to
        // the row this session actually touched — the practical risk isn't
        // necessarily two different teachers, it's the SAME teacher's own
        // second open tab autosaving stale catalog data over an edit just
        // made in the first.
        table: "titles",
        requiresStaffGate: true,
        getSource: (cache) => cache.titles,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((t) => t.id && t.ownerTeacherId).map((t) => ({
          id: t.id,
          owner_teacher_id: t.ownerTeacherId,
          name: t.name,
          description: t.description,
          icon: t.icon,
          rarity: t.rarity,
          active: t.active !== false,
          achievement_id: t.achievementId,
          text_color: t.textColor,
          border_color: t.borderColor,
          glow_color: t.glowColor,
          bg_color: t.bgColor,
          primary_color: t.primaryColor,
          secondary_color: t.secondaryColor,
          gradient_from: t.gradientFrom,
          gradient_to: t.gradientTo,
          border_style: t.borderStyle,
          animation: t.animation,
          particles: t.particles,
          bg_effect: t.bgEffect,
          custom_border_css: t.customBorderCSS,
          custom_animation_css: t.customAnimationCSS,
          custom_bg_css: t.customBgCSS,
          frame_shape: t.frameShape,
          frame_style: t.frameStyle,
          accent_color: t.accentColor,
          effect: t.effect,
          frame_template: t.frameTemplate
        })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Quizzes (the content catalog — Phase 20). Per-student
        // completedQuizzes/history and quiz_sections are out of scope here.
        // Phase 32: owner required. Phases 54/56/58/3: coalesces mirror the
        // pull-side coalesces so an older quiz saved before a field existed
        // pushes the same default the pull side already backfills, instead of
        // clobbering it with a raw undefined/null.
        // [Phase 5B] Ninth table converted to delta sync. Flat array,
        // client-generated id (uid(), assigned at draft-creation time in
        // quiz-builder.js's openQuizBuilder() — verified before converting,
        // same check that ruled out boss_events last session), same
        // whole-row-replacement-is-fine reasoning as titles.
        table: "quizzes",
        requiresStaffGate: true,
        getSource: (cache) => cache.quizzes,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((q) => q.id && q.ownerTeacherId).map((q) => ({
          id: q.id,
          owner_teacher_id: q.ownerTeacherId,
          title: q.title,
          description: q.desc,
          xp_reward: q.xpReward,
          coin_reward: q.coinReward,
          time_limit: q.timeLimit,
          rarity: q.rarity || "Common",
          cadence: q.cadence || "standing",
          chain_id: q.chainId || null,
          chain_order: q.chainOrder || 1,
          chain_label: q.chainLabel || null,
          start_date: q.startDate || null,
          end_date: q.endDate || null,
          stage_timers: Array.isArray(q.stageTimers) ? q.stageTimers : [null, null, null],
          questions: q.questions || [],
          active: q.active !== false
        })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Campaign worlds (the content catalog — Phase 22). stageProgress
        // (per-student) is out of scope. sort_order is stamped from each
        // world's position in cache.stageMap (no reorder-world feature — array
        // position IS the order). Phase 32: owner required.
        //
        // [Phase 5B] Tenth table converted to delta sync — but NOT a plain
        // config addition like titles/quizzes. buildRows used to compute
        // sort_order from `.map((w, idx) => ...)`'s own idx — i.e. the row's
        // position WITHIN THE ARRAY BEING MAPPED. That's correct for a
        // full-slice push (src IS cache.stageMap), but silently WRONG for a
        // delta-filtered push: the engine filters `src` down to only the
        // dirty world(s) before buildRows ever runs, so `idx` would become
        // the row's position within that small filtered subset — e.g. the
        // one dirty world sitting at position 5 in the real array would get
        // pushed with sort_order: 0, corrupting the map order server-side —
        // instead of just skipping the still-clean worlds around it. Fixed by
        // computing each world's true position from `cache.stageMap` (the
        // full, unfiltered array — buildRows always receives `cache` as its
        // second argument) rather than the `src` argument's own index, which
        // may or may not be the full array depending on what's dirty this
        // cycle. `fullOrder` below replicates the ORIGINAL two-step
        // filter-then-index logic exactly (not raw array position) so a
        // full-slice push (src === cache.stageMap, nothing filtered) computes
        // byte-identical sort_order values to the pre-Phase-5B code.
        table: "campaign_worlds",
        requiresStaffGate: true,
        getSource: (cache) => cache.stageMap,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows(src, cache) {
          const fullOrder = {};
          (cache.stageMap || []).filter((w) => w.id && w.ownerTeacherId).forEach((w, idx) => {
            fullOrder[w.id] = idx;
          });
          return src.filter((w) => w.id && w.ownerTeacherId).map((w) => ({
            id: w.id,
            owner_teacher_id: w.ownerTeacherId,
            label: w.label,
            icon: w.icon,
            color: w.color,
            description: w.desc,
            stages: w.stages || [],
            sort_order: fullOrder[w.id]
          }));
        },
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Point log: append-only history. Upsert by the client-generated id so
        // re-pushing a row doesn't insert duplicates.
        //
        // [Phase 5B] First table converted to delta/patch sync — see
        // _runTableSync()'s delta-tracking block below and
        // modules/core/state-manager.js's _DELTA_TRACKED_SLICES. Picked
        // deliberately as the doc's "lowest-traffic/lowest-consequence"
        // starting point: a point_log row's fields are fixed forever once
        // created (append-only — nothing ever edits an existing entry), so
        // there's no concurrent-same-row-edit scenario to get wrong while
        // this plumbing is new, unlike e.g. notifications' read flag or
        // orders' status. `idField` tells the engine which raw-cache-row
        // property to match against AppStore's dirty-id set.
        table: "point_log",
        getSource: (cache) => cache.pointLog,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((p) => p.id).map((p) => ({ id: p.id, student_id: p.studentId, what: p.what, pts: p.pts, when_label: p.when })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Notifications: same upsert-by-id shape as point_log. Unlike
        // point_log (append-only), these DO get updated in place (mark
        // read/mark-all-read).
        // [Phase 5B] Second table converted to delta sync — see
        // modules/core/state-manager.js's _DELTA_TRACKED_SLICES comment for
        // why: this is the first delta-tracked table with a field (`read`)
        // that actually gets mutated after the row is created, so it's the
        // first real exercise of the clobber this whole phase exists to
        // prevent (a session with a stale cached copy of a row it never
        // touched re-pushing that stale value over another session's write).
        table: "notifications",
        getSource: (cache) => cache.notifications,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((n) => n.id && n.studentId).map((n) => ({
          id: n.id,
          student_id: n.studentId,
          type: n.type,
          icon: n.icon,
          title: n.title,
          body: n.body,
          action: n.action,
          pts: n.pts,
          source_id: n.sourceId,
          read: !!n.read
        })),
        conflictKey: "id",
        deltaTracked: true,
        idField: "id"
      },
      {
        // Redemptions: orderId is already a unique client-generated key from
        // checkout time, reused directly as the upsert conflict target.
        // [Phase 5B] Sixth table converted to delta sync — append-only, same
        // low-blast-radius shape as point_log (the very first table
        // converted): a redemption's fields are fixed forever once created,
        // so no new mechanism was needed here, just the config addition.
        table: "redemptions",
        getSource: (cache) => cache.redemptions,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((r) => r.orderId).map((r) => ({
          order_id: r.orderId,
          student_id: r.studentId,
          item_id: r.itemId,
          item_name: r.itemName,
          emoji: r.emoji,
          item_label: r.item,
          pts: r.pts,
          date_label: r.date,
          time_label: r.time,
          claim_code: r.claimCode
        })),
        conflictKey: "order_id",
        deltaTracked: true,
        idField: "orderId"
      },
      {
        // Phase 48 — orders: mirrors redemptions' pattern exactly, same
        // client-generated orderId conflict target. Covers cartCheckout() (new
        // pending orders), posExecuteClaim()/posExecuteCancel() (staff status
        // transitions), and ordExecuteCancel() (student self-cancel).
        //
        // [Phase 5B] Third table converted to delta sync — see
        // modules/core/state-manager.js's _DELTA_TRACKED_SLICES comment: this
        // is the first delta-tracked table where several columns
        // (status/claimed_at/claimed_by, or cancelled_at/cancel_reason/
        // cancelled_by) change together as one transition, rather than a
        // single boolean, so a stale whole-slice push here could revert
        // multiple related fields on a row at once.
        table: "orders",
        getSource: (cache) => cache.orders,
        hasRows: (src) => Array.isArray(src) && src.length > 0,
        buildRows: (src) => src.filter((o) => o.orderId).map((o) => ({
          order_id: o.orderId,
          student_id: o.studentId,
          student_name: o.studentName,
          student_init: o.studentInit,
          student_color: o.studentColor,
          item_id: o.itemId,
          item_name: o.itemName,
          emoji: o.emoji,
          cost: o.cost,
          category: o.category,
          claim_code: o.claimCode,
          status: o.status || "pending",
          created_at: o.createdAt,
          created_date_str: o.createdDateStr,
          // claimedAt/cancelledAt are epoch-ms numbers locally — convert to
          // timestamptz on the way out, mirror of the pull-side Date.parse().
          claimed_at: o.claimedAt ? new Date(o.claimedAt).toISOString() : null,
          claimed_by: o.claimedBy,
          cancelled_at: o.cancelledAt ? new Date(o.cancelledAt).toISOString() : null,
          cancel_reason: o.cancelReason,
          cancelled_by: o.cancelledBy
        })),
        conflictKey: "order_id",
        deltaTracked: true,
        idField: "orderId"
      },
      {
        // Phase 48 — inventory: keyed by (student_id, item_id) rather than a
        // single id, since DB.inventory is {studentId: [...]}. Flatten that
        // shape into rows here; the composite PK does the per-item upsert.
        // [Phase 5B] Fifth table converted to delta sync — first with a
        // genuinely different HUMAN ROLE (not just a different student) able
        // to dirty the same list: shop_pos_terminal.js writes into
        // draft.inventory[studentId] on a student's behalf when a TEACHER
        // runs the POS terminal, while that student's own device can
        // independently purchase something at the same time via
        // shop_store.js. Both append to the same student's item array from
        // two different sessions — the old whole-slice push meant either
        // side's stale cached copy of the other's most recent addition could
        // silently drop it the next time either side saved for an unrelated
        // reason.
        table: "inventory",
        getSource: (cache) => cache.inventory,
        hasRows: (src) => !!(src && typeof src === "object"),
        buildRows(src) {
          const rows = [];
          Object.keys(src).forEach((sid) => {
            (src[sid] || []).forEach((item) => {
              if (!item.itemId) return;
              rows.push({
                student_id: sid,
                item_id: item.itemId,
                item_name: item.itemName,
                emoji: item.emoji,
                category: item.category,
                quantity: item.quantity || 1,
                date_purchased: item.datePurchased,
                last_purchased: item.lastPurchased,
                source: item.source || "Store",
                status: item.status || "active",
                used_at: item.usedAt
              });
            });
          });
          return rows;
        },
        conflictKey: "student_id,item_id",
        deltaTracked: true,
        // Composite studentId->[items] source needs its own filter, same
        // reason as boss_participants: no single idField can express dirtiness
        // across a nested object-of-arrays shape. No uuid-resolution step
        // needed here (unlike boss_participants) — inventory rows don't
        // reference another table's server-generated id.
        deltaFilterSource(source, dirtySet) {
          const filtered = {};
          const ids = [];
          Object.keys(source).forEach((sid) => {
            const matched = (source[sid] || []).filter((item) => item.itemId && dirtySet.has(sid + ":" + item.itemId));
            if (matched.length) {
              filtered[sid] = matched;
              matched.forEach((item) => ids.push(sid + ":" + item.itemId));
            }
          });
          return { source: filtered, ids };
        }
      },
      {
        // Phase 57: quiz_history, append-only per-student attempt log. Upsert
        // by the client-generated id, same convention as point_log. Entries
        // from before this phase have no id and are skipped (stay visible
        // locally; never sync retroactively).
        // [Phase 5B] Eighth table converted to delta sync. quizHistory
        // [studentId] = [attempts...] — same 'nestedArray' shape as
        // inventory. Append-only (finishQuiz()/abortQuiz() in index.html
        // never edit an existing entry), client-generated id ('qh_' + uid())
        // at creation, same low-blast-radius shape as point_log/redemptions.
        table: "quiz_history",
        getSource: (cache) => cache.quizHistory,
        hasRows: (src) => !!(src && typeof src === "object"),
        buildRows(src) {
          const rows = [];
          Object.keys(src).forEach((sid) => {
            (src[sid] || []).forEach((h) => {
              if (!h.id || !h.quizId) return;
              rows.push({
                id: h.id,
                student_id: sid,
                quiz_id: h.quizId,
                score: h.score || 0,
                attempt: h.attempt || 1,
                completed_at: h.completedAt,
                date_label: h.date,
                // Phase 59: an entry logged before per-question tracking
                // existed has no `results` array — push null, not [], so it
                // isn't misread as "0 questions."
                question_results: Array.isArray(h.results) ? h.results : null,
                // Phase 63: without this, abortQuiz()'s aborted:true never
                // left the browser, so a walked-away attempt looked complete.
                aborted: !!h.aborted
              });
            });
          });
          return rows;
        },
        conflictKey: "id",
        deltaTracked: true,
        // Same shape/reasoning as inventory's deltaFilterSource — no
        // uuid-resolution step needed, quiz_history rows don't reference
        // another table's server-generated id.
        deltaFilterSource(source, dirtySet) {
          const filtered = {};
          const ids = [];
          Object.keys(source).forEach((sid) => {
            const matched = (source[sid] || []).filter((h) => h.id && dirtySet.has(sid + ":" + h.id));
            if (matched.length) {
              filtered[sid] = matched;
              matched.forEach((h) => ids.push(sid + ":" + h.id));
            }
          });
          return { source: filtered, ids };
        }
      }
    ];
    async function _pushTable(label, fn) {
      try {
        await fn();
      } catch (e) {
        console.warn("[DBService] remote sync failed for " + label + ", staying on local cache:", e);
      }
    }
    async function _runTableSync(client, cache, isCatalogStaffSession) {
      for (const cfg of _TABLE_SYNC_CONFIGS) {
        let source = cfg.getSource(cache);
        if (!cfg.hasRows(source, cache)) continue;
        if (cfg.requiresStaffGate && !isCatalogStaffSession) continue;
        let dirtyIds = null;
        if (cfg.deltaTracked && typeof AppStore !== "undefined" && typeof AppStore.getDirtyIds === "function") {
          const d = AppStore.getDirtyIds(cfg.table);
          if (Array.isArray(d)) dirtyIds = d;
        }
        let matchedIdsForClear = null;
        if (dirtyIds !== null) {
          if (dirtyIds.length === 0) continue;
          const dirtySet = new Set(dirtyIds);
          if (cfg.deltaFilterSource) {
            const filtered = cfg.deltaFilterSource(source, dirtySet, cache);
            source = filtered.source;
            matchedIdsForClear = filtered.ids;
          } else {
            source = Array.isArray(source) ? source.filter((row) => dirtySet.has(row[cfg.idField])) : source;
          }
        }
        await _pushTable(cfg.table, async () => {
          if (cfg.upsertRows) {
            const succeededIds = await cfg.upsertRows(client, source, cache);
            if (dirtyIds !== null && typeof AppStore.clearDirty === "function" && Array.isArray(succeededIds) && succeededIds.length) {
              AppStore.clearDirty(cfg.table, succeededIds);
            }
            return;
          }
          const rows = cfg.buildRows(source, cache);
          if (rows.length) {
            const { error } = await client.from(cfg.table).upsert(rows, { onConflict: cfg.conflictKey });
            if (error) throw error;
          }
          if (dirtyIds !== null && typeof AppStore.clearDirty === "function" && rows.length) {
            const idsToClear = matchedIdsForClear !== null ? matchedIdsForClear : rows.map((r) => r[cfg.conflictKey]);
            AppStore.clearDirty(cfg.table, idsToClear);
          }
        });
      }
    }
    async function _pushCacheToSupabase(client, cache) {
      const isCatalogStaffSession = typeof currentUser !== "undefined" && currentUser && (currentUser.role === "admin" || currentUser.role === "teacher");
      await _runTableSync(client, cache, isCatalogStaffSession);
    }
    return {
      pushCacheToSupabase: _pushCacheToSupabase,
      tableSyncConfigs: _TABLE_SYNC_CONFIGS
    };
  })();
  window.TableSyncRepository = TableSyncRepository;

  // src/db-service.js
  var DBService2 = (function() {
    "use strict";
    const _STORAGE_KEY = "eduquest_db_v3";
    const _SCHEMA_VER = 4;
    const _LAST_SYNCED_UID_KEY = "eduquest_last_synced_uid";
    const _DIRTY_TRACKING_KEY = "eduquest_dirty_v1";
    const _meta = {
      provider: "unresolved",
      schemaVersion: _SCHEMA_VER,
      asyncReady: "partial",
      // [BLOCKER-SYNC] — see file header
      signalChannelReady: false,
      // flipped true once Realtime channel subscribes
      schemaVersioned: true,
      // [BLOCKER-SCHEMA] resolved
      authReady: "partial",
      // [BLOCKER-AUTH] — see file header
      online: navigator.onLine,
      lastRemoteSyncAt: null,
      lastSaveAt: null,
      lastLoadAt: null,
      saveCount: 0,
      loadCount: 0,
      pendingUploads: 0,
      // queued local writes not yet confirmed on the server
      lastError: null
    };
    let _cache = null;
    let _sessionEpoch = 0;
    const _localStorageProvider = {
      read: function() {
        return localStorage.getItem(_STORAGE_KEY);
      },
      write: function(raw) {
        localStorage.setItem(_STORAGE_KEY, raw);
      },
      remove: function() {
        localStorage.removeItem(_STORAGE_KEY);
      },
      key: _STORAGE_KEY
    };
    function _getClient() {
      return SupabaseClient.getClient();
    }
    function _resolveProvider() {
      return SupabaseClient.resolveProvider();
    }
    let _uploadTimer = null;
    function _queueUpload() {
      _meta.pendingUploads++;
      if (_uploadTimer) clearTimeout(_uploadTimer);
      const queuedEpoch = _sessionEpoch;
      _uploadTimer = setTimeout(function() {
        _flushUpload(queuedEpoch);
      }, 400);
    }
    async function _flushUpload(queuedEpoch) {
      _uploadTimer = null;
      if (queuedEpoch !== _sessionEpoch) {
        _meta.pendingUploads = 0;
        return;
      }
      const client = _getClient();
      if (!client || !_cache) {
        _meta.pendingUploads = 0;
        return;
      }
      try {
        const { data: sessionData } = await client.auth.getSession();
        if (!sessionData || !sessionData.session) {
          _meta.pendingUploads = 0;
          return;
        }
      } catch (e) {
        _meta.pendingUploads = 0;
        return;
      }
      try {
        await _pushCacheToSupabase(client, _cache);
        _meta.pendingUploads = 0;
        _meta.lastRemoteSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        _meta.online = true;
      } catch (e) {
        _meta.lastError = String(e && e.message || e);
        _meta.online = navigator.onLine;
        console.warn("[DBService] remote sync failed, staying on local cache:", e);
      }
    }
    async function _pullCacheFromSupabase(client) {
      const [
        profiles,
        bossEvents,
        bossParticipants,
        lootClaims,
        achievements,
        userAchievements,
        registrations,
        pointLog,
        redemptions,
        recitationLog,
        rfidCards,
        attendanceSchedules,
        attendanceLogs,
        shopProducts,
        mailMessages,
        quizSections,
        achievementSections,
        titles,
        titleUnlocks,
        quizzes,
        titleSections,
        campaignWorlds,
        orders,
        inventoryRows,
        campaignStageSections,
        quizHistoryRows,
        notifications,
        studentSkillRows,
        recitationSessions
      ] = await Promise.all([
        client.from("profiles").select("*"),
        client.from("boss_events").select("*"),
        client.from("boss_participants").select("*"),
        client.from("loot_claims").select("*"),
        client.from("achievements").select("*"),
        client.from("user_achievements").select("*"),
        client.from("registrations").select("*"),
        // Priority 2 Fix 2 — bounded history windows on the 8 append-only
        // tables (see _HISTORY_LIMITS above). "load more" beyond this
        // default window goes through loadMoreHistory() (public API).
        client.from("point_log").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.point_log),
        client.from("redemptions").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.redemptions),
        client.from("recitation_log").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.recitation_log),
        client.from("rfid_cards").select("*"),
        client.from("attendance_schedules").select("*"),
        client.from("attendance_logs").select("*").order("log_date", { ascending: false }).limit(_HISTORY_LIMITS.attendance_logs),
        client.from("shop_products").select("*"),
        // Phase 14
        client.from("mail_messages").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.mail_messages),
        // Phase 15
        client.from("quiz_sections").select("*"),
        // Phase 15
        client.from("achievement_sections").select("*"),
        // Phase 16
        client.from("titles").select("*"),
        // Phase 18
        client.from("title_unlocks").select("*"),
        // Phase 18
        client.from("quizzes").select("*"),
        // Phase 20 — quiz content (was local-only; see phase20_quiz_content_sync.sql)
        client.from("title_sections").select("*"),
        // Phase 21 — read side of title section-scoping
        client.from("campaign_worlds").select("*").order("sort_order", { ascending: true }),
        // Phase 22 — campaign content (was local-only; see phase22_campaign_content_sync.sql)
        client.from("orders").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.orders),
        // Phase 48
        client.from("inventory").select("*"),
        // Phase 48
        client.from("campaign_stage_sections").select("*"),
        // Phase 53 — read side of campaign per-section visibility (table existed since Phase 14, never wired up until now)
        client.from("quiz_history").select("*").order("completed_at", { ascending: false }).limit(_HISTORY_LIMITS.quiz_history),
        // Phase 57 — was local-only; see phase57_quiz_history_sync.sql
        client.from("notifications").select("*").order("created_at", { ascending: false }).limit(_HISTORY_LIMITS.notifications),
        // Phase 67 — student notification bell; see phase67_notifications.sql
        client.from("student_skills").select("*"),
        // Phase 7 (Campaign Redesign) — see phase68_campaign_student_skills.sql
        client.from("recitation_sessions").select("*")
        // Phase 71 — cross-device "Start Recitation Session" sync; see phase71_recitation_session_sync.sql
      ]);
      for (const r of [
        profiles,
        bossEvents,
        bossParticipants,
        lootClaims,
        achievements,
        userAchievements,
        registrations,
        pointLog,
        redemptions,
        recitationLog,
        rfidCards,
        attendanceSchedules,
        attendanceLogs,
        shopProducts,
        mailMessages,
        quizSections,
        achievementSections,
        titles,
        titleUnlocks,
        quizzes,
        titleSections,
        campaignWorlds,
        orders,
        inventoryRows,
        campaignStageSections,
        quizHistoryRows,
        notifications,
        studentSkillRows,
        recitationSessions
      ]) {
        if (r.error) throw r.error;
      }
      const { quizHistoryByStudent } = _deriveQuizHistory(quizHistoryRows.data);
      const students = _deriveStudents(profiles.data, quizHistoryByStudent);
      const admin = _deriveAdmin(profiles.data, _cache?.admin);
      const equippedTitles = _deriveEquippedTitles(profiles.data);
      const { bossEventsArr, bossIdById } = _deriveBossEvents(bossEvents.data, lootClaims.data);
      const bossParticipantsObj = _deriveBossParticipants(bossParticipants.data, bossIdById);
      const titlesArr = _deriveTitles(titles.data);
      const campaignWorldsArr = _deriveCampaignWorlds(campaignWorlds.data);
      return {
        schemaVersion: _SCHEMA_VER,
        students,
        // Fall back to the locally-cached admin record (or DEFAULT_DB.admin) when
        // no admin/teacher profile row exists in Supabase yet (e.g. fresh deployment,
        // RLS preventing the anon key from reading that row, or Phase-2 auth not yet
        // set up). Without this, DB.admin is null and doLogin() throws on DB.admin.id.
        admin,
        bossEvents: bossEventsArr,
        bossParticipants: bossParticipantsObj,
        achievements: _deriveAchievements(achievements.data),
        achievementUnlocks: _deriveAchievementUnlocks(userAchievements.data),
        titles: titlesArr,
        titleUnlocks: _deriveTitleUnlocks(titleUnlocks.data),
        equippedTitles,
        // Phase 18
        titleSectionAssignments: _deriveTitleSectionAssignments(titleSections.data),
        // Phase 21
        // Phase 14: shop is per-teacher — RLS on shop_products already scopes
        // this to (a) products this session's own teacher owns, or (b)
        // products owned by the adviser of this session's own section, so no
        // extra client-side filter is needed here, same as every other table.
        store: _deriveStore(shopProducts.data),
        // Phase 15 — see _deriveMail's comments.
        mail: _deriveMail(mailMessages.data, profiles.data, titlesArr),
        quizSectionAssignments: _deriveQuizSectionAssignments(quizSections.data),
        achievementSectionAssignments: _deriveAchievementSectionAssignments(achievementSections.data),
        // Phase 16
        registrations: _deriveRegistrations(registrations.data),
        pointLog: _derivePointLog(pointLog.data),
        redemptions: _deriveRedemptions(redemptions.data),
        // Phase 48 — mirrors DB.orders[] exactly. See cartCheckout() (creates),
        // shop_pos_terminal.js (staff claim/cancel), shop_orders.js (student
        // self-cancel) — all pre-existing client logic, previously local-only.
        orders: _deriveOrders(orders.data),
        // Phase 48 — mirrors DB.inventory{} exactly.
        inventory: _deriveInventory(inventoryRows.data),
        // Phase 57 — mirrors DB.quizHistory{} exactly.
        quizHistory: quizHistoryByStudent,
        // Phase 7 (Campaign Redesign) — mirrors DB.studentSkills{} exactly.
        studentSkills: _deriveStudentSkills(studentSkillRows.data),
        // Phase 67 — student notification bell. Rows are written by
        // notification-service.js (client-side synthesis from pointLog/orders,
        // never inserted directly at the source — see that file's header
        // comment), so this pull is a straight passthrough, same shape as
        // pointLog above.
        notifications: _deriveNotifications(notifications.data),
        recitationLog: _deriveRecitationLog(recitationLog.data),
        // Phase 71 — cross-device "Start Recitation Session" sync. Read-only
        // passthrough; writes go exclusively through start_recitation_session()/
        // stop_recitation_session() (recitation-service.js).
        recitationSessions: _deriveRecitationSessions(recitationSessions.data),
        // ── Phase 1 RFID/Attendance — READ-ONLY slices ──────────────────────
        // Every write to these three comes from AttendanceService via
        // DBService.rpc(), never from this bulk-pull/push path — see
        // attendance-service.js and the RPC functions in
        // supabase/phase1_rfid_attendance.sql. Pulling them here just keeps
        // AppStore's slices fresh for read paths (dashboards, analytics).
        rfidCards: _deriveRfidCards(rfidCards.data),
        attendanceSchedules: _deriveAttendanceSchedules(attendanceSchedules.data),
        attendanceLogs: _deriveAttendanceLogs(attendanceLogs.data),
        // Fields not yet migrated to relational tables (Phase 2/3 scope — see
        // migration-strategy.md "What stays on localStorage for now"):
        quizzes: _deriveQuizzes(quizzes.data),
        attendanceSessions: _cache?.attendanceSessions || [],
        // Phase 22: campaign content catalog — see _deriveCampaignWorlds/
        // _deriveCampaignSectionAssignments. stageProgress (per-student
        // progress) stays local-cache-only — out of scope for now. quiz
        // history is NO LONGER in this bucket — see quizHistory above (Phase 57).
        stageMap: campaignWorldsArr,
        stageProgress: _cache?.stageProgress || {},
        campaignSectionAssignments: _deriveCampaignSectionAssignments(campaignStageSections.data, campaignWorldsArr),
        // Phase 53
        _bossIdById: bossIdById
        // internal map, see _pushCacheToSupabase
      };
    }
    const _FULL_PULL_SENTINEL = "__full__";
    async function _applyScopedRefresh(client, changedTables) {
      if (!_cache || changedTables.includes(_FULL_PULL_SENTINEL)) {
        _cache = await _pullCacheFromSupabase(client);
        return;
      }
      const groups = /* @__PURE__ */ new Set();
      for (const t of changedTables) {
        const g = _REALTIME_TABLE_GROUPS[t];
        if (!g) {
          groups.add(_FULL_PULL_SENTINEL);
          break;
        }
        groups.add(g);
      }
      if (groups.has(_FULL_PULL_SENTINEL)) {
        _cache = await _pullCacheFromSupabase(client);
        return;
      }
      const groupList = Array.from(groups);
      const results = await Promise.all(groupList.map(async (g) => {
        const def = _REFRESH_GROUPS[g];
        const raw = await def.fetch(client);
        for (const key in raw) {
          if (raw[key].error) throw raw[key].error;
        }
        return def.apply(raw, _cache);
      }));
      const merged = { ..._cache };
      results.forEach((partial) => Object.assign(merged, partial));
      _cache = merged;
    }
    function _pushCacheToSupabase(client, cache) {
      return TableSyncRepository.pushCacheToSupabase(client, cache);
    }
    let _signalChannel = null;
    let _tableSyncChannel = null;
    const _signalSubscribers = {};
    function _setupRealtimeSignals(client) {
      _signalChannel = client.channel("eduquest-signals");
      _signalChannel.on("broadcast", { event: "*" }, (msg) => {
        const handlers = _signalSubscribers[msg.event] || [];
        handlers.forEach((fn) => {
          try {
            fn(msg.payload);
          } catch (e) {
            console.error(e);
          }
        });
      });
      _signalChannel.subscribe((status) => {
        _meta.signalChannelReady = status === "SUBSCRIBED";
      });
      _tableSyncChannel = client.channel("eduquest-table-sync").on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => _schedulePullRefresh("profiles")).on("postgres_changes", { event: "*", schema: "public", table: "boss_events" }, () => _schedulePullRefresh("boss_events")).on("postgres_changes", { event: "*", schema: "public", table: "loot_claims" }, () => _schedulePullRefresh("loot_claims")).on("postgres_changes", { event: "*", schema: "public", table: "user_achievements" }, () => _schedulePullRefresh("user_achievements")).on("postgres_changes", { event: "*", schema: "public", table: "attendance_logs" }, () => _schedulePullRefresh("attendance_logs")).on("postgres_changes", { event: "*", schema: "public", table: "rfid_cards" }, () => _schedulePullRefresh("rfid_cards")).on("postgres_changes", { event: "*", schema: "public", table: "recitation_log" }, () => _schedulePullRefresh("recitation_log")).on("postgres_changes", { event: "*", schema: "public", table: "mail_messages" }, () => _schedulePullRefresh("mail_messages")).on("postgres_changes", { event: "*", schema: "public", table: "quiz_sections" }, () => _schedulePullRefresh("quiz_sections")).on("postgres_changes", { event: "*", schema: "public", table: "achievement_sections" }, () => _schedulePullRefresh("achievement_sections")).on("postgres_changes", { event: "*", schema: "public", table: "achievements" }, () => _schedulePullRefresh("achievements")).on("postgres_changes", { event: "*", schema: "public", table: "titles" }, () => _schedulePullRefresh("titles")).on("postgres_changes", { event: "*", schema: "public", table: "title_unlocks" }, () => _schedulePullRefresh("title_unlocks")).on("postgres_changes", { event: "*", schema: "public", table: "quizzes" }, () => _schedulePullRefresh("quizzes")).on("postgres_changes", { event: "*", schema: "public", table: "title_sections" }, () => _schedulePullRefresh("title_sections")).on("postgres_changes", { event: "*", schema: "public", table: "campaign_worlds" }, () => _schedulePullRefresh("campaign_worlds")).on("postgres_changes", { event: "*", schema: "public", table: "campaign_stage_sections" }, () => _schedulePullRefresh("campaign_stage_sections")).on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => _schedulePullRefresh("orders")).on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => _schedulePullRefresh("inventory")).on("postgres_changes", { event: "*", schema: "public", table: "quiz_history" }, () => _schedulePullRefresh("quiz_history")).on("postgres_changes", { event: "*", schema: "public", table: "point_log" }, () => _schedulePullRefresh("point_log")).on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => _schedulePullRefresh("notifications")).on("postgres_changes", { event: "*", schema: "public", table: "student_skills" }, () => _schedulePullRefresh("student_skills")).on("postgres_changes", { event: "*", schema: "public", table: "recitation_sessions" }, () => _schedulePullRefresh("recitation_sessions")).subscribe();
    }
    let _pullRefreshTimer = null;
    let _pendingRefreshTables = /* @__PURE__ */ new Set();
    function _schedulePullRefresh(table) {
      _pendingRefreshTables.add(table || _FULL_PULL_SENTINEL);
      if (_pullRefreshTimer) clearTimeout(_pullRefreshTimer);
      _pullRefreshTimer = setTimeout(async () => {
        const changedTables = Array.from(_pendingRefreshTables);
        _pendingRefreshTables = /* @__PURE__ */ new Set();
        const client = _getClient();
        if (!client) return;
        try {
          await _applyScopedRefresh(client, changedTables);
          _localStorageProvider.write(JSON.stringify(_cache));
          _meta.lastRemoteSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          if (window.AppStore && typeof window.AppStore.syncFromLegacy === "function") {
            window.AppStore.syncFromLegacy(_cache, "state:remote-sync");
          }
        } catch (e) {
          console.warn("[DBService] realtime refresh pull failed:", e);
        }
      }, 400);
    }
    const _HISTORY_TABLE_CONFIG = {
      pointLog: { table: "point_log", orderCol: "created_at", derive: _derivePointLog },
      redemptions: { table: "redemptions", orderCol: "created_at", derive: _deriveRedemptions },
      recitationLog: { table: "recitation_log", orderCol: "created_at", derive: _deriveRecitationLog },
      attendanceLogs: { table: "attendance_logs", orderCol: "log_date", derive: _deriveAttendanceLogs },
      orders: { table: "orders", orderCol: "created_at", derive: _deriveOrders },
      notifications: { table: "notifications", orderCol: "created_at", derive: _deriveNotifications }
    };
    async function _loadMoreHistory(cacheKey, pageSize) {
      const cfg = _HISTORY_TABLE_CONFIG[cacheKey];
      if (!cfg) {
        throw new Error(`[DBService] loadMoreHistory: unsupported key "${cacheKey}" (expected one of: ${Object.keys(_HISTORY_TABLE_CONFIG).join(", ")})`);
      }
      const client = _getClient();
      if (!client || !_cache) return { added: 0, exhausted: true };
      const already = (_cache[cacheKey] || []).length;
      const limit = pageSize || _HISTORY_LIMITS[cfg.table] || 200;
      const res = await client.from(cfg.table).select("*").order(cfg.orderCol, { ascending: false }).range(already, already + limit - 1);
      if (res.error) throw res.error;
      const newRows = cfg.derive(res.data);
      _cache = { ..._cache, [cacheKey]: [..._cache[cacheKey] || [], ...newRows] };
      _localStorageProvider.write(JSON.stringify(_cache));
      if (window.AppStore && typeof window.AppStore.syncFromLegacy === "function") {
        window.AppStore.syncFromLegacy(_cache, "state:remote-sync");
      }
      return { added: newRows.length, exhausted: newRows.length < limit };
    }
    return {
      /**
       * initRemote() → Promise<void>
       * MUST be awaited once, before AppStore.init() runs (i.e. before
       * state-manager.js's auto-init IIFE — see migration-strategy.md for the
       * exact index.html change: state-manager.js's auto-init is wrapped so
       * it waits on a resolved promise instead of running at parse time).
       * Hydrates _cache from Supabase, or from localStorage if offline/no
       * Supabase config is present — this is the "No Downtime" fallback.
       */
      initRemote: async function() {
        _meta.provider = _resolveProvider();
        const client = _getClient();
        if (!client) {
          console.warn("[DBService] No Supabase client configured \u2014 running on localStorage only.");
          _cache = null;
          return;
        }
        try {
          const { data: sessionData } = await client.auth.getSession();
          if (!sessionData || !sessionData.session) {
            console.warn("[DBService] No saved session yet \u2014 loading local cache only; will pull fresh right after login.");
            _meta.online = false;
            try {
              const raw = _localStorageProvider.read();
              _cache = raw ? JSON.parse(raw) : null;
            } catch (e2) {
              _cache = null;
            }
            _setupRealtimeSignals(client);
            return;
          }
          const _uid = sessionData.session.user && sessionData.session.user.id;
          let _localMirror = null;
          try {
            const rawMirror = _localStorageProvider.read();
            const stampedUid = window.localStorage.getItem(_LAST_SYNCED_UID_KEY);
            if (rawMirror && stampedUid && _uid && stampedUid === _uid) {
              _localMirror = JSON.parse(rawMirror);
            }
          } catch (e3) {
            _localMirror = null;
          }
          if (_localMirror) {
            _cache = _localMirror;
            _meta.online = true;
            _setupRealtimeSignals(client);
            _pullCacheFromSupabase(client).then(function(fresh) {
              _cache = fresh;
              _localStorageProvider.write(JSON.stringify(_cache));
              if (_uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, _uid);
              _meta.lastRemoteSyncAt = (/* @__PURE__ */ new Date()).toISOString();
              _meta.online = true;
              if (window.AppStore && typeof window.AppStore.syncFromLegacy === "function") {
                window.AppStore.syncFromLegacy(_cache, "state:remote-sync");
              }
            }).catch(function(e4) {
              console.warn("[DBService] background initial-boot pull failed, staying on cached snapshot:", e4);
              _meta.lastError = String(e4 && e4.message || e4);
            });
            return;
          }
          _cache = await _pullCacheFromSupabase(client);
          _localStorageProvider.write(JSON.stringify(_cache));
          if (_uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, _uid);
          _meta.lastRemoteSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          _meta.online = true;
          _setupRealtimeSignals(client);
        } catch (e) {
          console.error("[DBService] initial Supabase pull failed, falling back to local cache:", e);
          _meta.lastError = String(e && e.message || e);
          _meta.online = false;
          try {
            const raw = _localStorageProvider.read();
            _cache = raw ? JSON.parse(raw) : null;
          } catch (e2) {
            _cache = null;
          }
        }
      },
      /**
       * refreshAfterAuthChange() → Promise<void>
       * Re-pulls the full dataset under whichever Supabase Auth session is
       * CURRENTLY active, overwrites the in-memory cache + localStorage
       * mirror, and pushes the fresh data to AppStore so already-rendered UI
       * updates immediately.
       *
       * MUST be called right after every successful doLogin() (see auth.js),
       * before bootApp() renders the dashboard. Without this, whatever was
       * pulled during the LAST initRemote() call (e.g. under a previous
       * account's session, or no session at all) just keeps sitting in
       * memory — signInWithPassword() only changes which account can WRITE
       * and which RLS rows are visible on the NEXT query; it does not
       * retroactively re-scope data that's already sitting in the client-side
       * cache.
       *
       * This is what caused a teacher account to see a *different* teacher's
       * (or admin's) full roster after switching accounts in the same browser
       * without an intervening full page reload — see
       * REPORT_cross_account_data_and_template_row.md, Part 5. RLS itself was
       * never broken; the cache was just stale.
       */
      refreshAfterAuthChange: async function() {
        const client = _getClient();
        if (!client) return;
        _sessionEpoch++;
        if (_uploadTimer) {
          clearTimeout(_uploadTimer);
          _uploadTimer = null;
        }
        try {
          _cache = await _pullCacheFromSupabase(client);
          _localStorageProvider.write(JSON.stringify(_cache));
          try {
            const { data: sd } = await client.auth.getSession();
            const uid = sd && sd.session && sd.session.user && sd.session.user.id;
            if (uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, uid);
          } catch (eStamp) {
          }
          _meta.lastRemoteSyncAt = (/* @__PURE__ */ new Date()).toISOString();
          _meta.online = true;
          _meta.lastError = null;
          if (window.AppStore && typeof window.AppStore.syncFromLegacy === "function") {
            window.AppStore.syncFromLegacy(_cache, "state:auth-change-sync");
          }
        } catch (e) {
          _cache = null;
          try {
            _localStorageProvider.remove();
          } catch (e2) {
          }
          _meta.lastError = String(e && e.message || e);
          _meta.online = false;
          console.warn("[DBService] refreshAfterAuthChange pull failed, dashboard may show stale data:", e);
        }
      },
      /**
       * read(defaultValue) → Object   [SYNCHRONOUS — see THE SYNC PROBLEM]
       * Returns a deep clone of the in-memory cache. If the cache was never
       * hydrated (initRemote() not called, or both Supabase and localStorage
       * are empty), returns a deep clone of defaultValue, exactly like v1.
       *
       * BUGFIX: defaultValue is optional — every existing call site in the
       * app calls loadDB() / DBService.read() with NO argument and relies on
       * DEFAULT_DB already being baked in elsewhere. JSON.stringify(undefined)
       * returns the bare string "undefined", and JSON.parse("undefined")
       * throws — so this must check for undefined explicitly rather than
       * blindly round-tripping whatever was passed in.
       */
      read: function(defaultValue) {
        _meta.loadCount++;
        _meta.lastLoadAt = (/* @__PURE__ */ new Date()).toISOString();
        if (_cache) return JSON.parse(JSON.stringify(_cache));
        try {
          var raw = _localStorageProvider.read();
          if (raw) {
            _cache = JSON.parse(raw);
            return JSON.parse(JSON.stringify(_cache));
          }
        } catch (e) {
        }
        if (defaultValue === void 0 || defaultValue === null) return null;
        return JSON.parse(JSON.stringify(defaultValue));
      },
      /**
       * write(db) → void   [SYNCHRONOUS locally, ASYNC remotely]
       * Updates the in-memory cache and the localStorage mirror IMMEDIATELY
       * (so a refresh or network loss never loses the last write), then
       * queues a debounced push to Supabase.
       */
      write: function(db) {
        _meta.saveCount++;
        _meta.lastSaveAt = (/* @__PURE__ */ new Date()).toISOString();
        _cache = db;
        try {
          _localStorageProvider.write(JSON.stringify(db));
        } catch (e) {
          console.warn("[DBService] localStorage mirror write failed (quota?):", e);
        }
        if (_getClient()) _queueUpload();
      },
      /**
       * mirrorLocalOnly(db) → void
       * BUGFIX (inventory/quiz_history 42501 storm once realtime actually
       * delivers events): write(db) always queues a push back to Supabase.
       * That's correct for a genuine LOCAL mutation, but state-manager.js's
       * syncFromLegacy() also calls into the write path for data that just
       * arrived FROM Supabase (state:remote-sync / state:auth-change-sync —
       * see db-service.js's own syncFromLegacy call sites). Pushing that
       * straight back is a pure echo: it re-upserts every table in the full
       * cache, including inventory/quiz_history rows for every student in
       * the system, not just this session's own section (those two tables
       * never got the per-class_id filtering the profiles upsert above has).
       * Most of that gets rejected by RLS (42501), and any row that DOES
       * belong to this session fires its own postgres_changes event,
       * re-triggering the same pull -> sync -> push cycle indefinitely.
       * This existed as long as the write path did, but stayed silent until
       * realtime was actually delivering events (it wasn't, until the
       * supabase_realtime publication got repaired). Use this instead of
       * write() for any sync whose data source IS Supabase — update the
       * local cache/mirror so the UI stays current, but never re-push
       * something that already reflects the server.
       */
      mirrorLocalOnly: function(db) {
        _meta.saveCount++;
        _meta.lastSaveAt = (/* @__PURE__ */ new Date()).toISOString();
        _cache = db;
        try {
          _localStorageProvider.write(JSON.stringify(db));
        } catch (e) {
          console.warn("[DBService] localStorage mirror write failed (quota?):", e);
        }
      },
      /**
       * writeDirty(dirtySnapshot) → void
       * [Phase 5B bugfix] Persists AppStore's delta-sync dirty-id tracking —
       * see _DIRTY_TRACKING_KEY's own comment for the bug this closes.
       * `dirtySnapshot` is a plain `{ [table]: string[] }` object (AppStore
       * serializes its internal Sets before calling this). Synchronous,
       * localStorage-only — this is small bookkeeping metadata, not app
       * data, so it deliberately never touches _cache or queues a Supabase
       * push of its own.
       */
      writeDirty: function(dirtySnapshot) {
        try {
          localStorage.setItem(_DIRTY_TRACKING_KEY, JSON.stringify(dirtySnapshot));
        } catch (e) {
          console.warn("[DBService] dirty-tracking localStorage write failed (quota?):", e);
        }
      },
      /**
       * readDirty() → { [table]: string[] } | null
       * [Phase 5B bugfix] Companion to writeDirty() — called once during
       * AppStore.init() to restore dirty-id tracking across a reload. Returns
       * null (not throw) on anything unexpected — a missing/corrupt entry
       * here should degrade to "nothing was pending," never crash boot.
       */
      readDirty: function() {
        try {
          const raw = localStorage.getItem(_DIRTY_TRACKING_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          console.warn("[DBService] dirty-tracking localStorage read failed (corrupt entry?):", e);
          return null;
        }
      },
      /**
       * teardownRealtime() → void
       * BUGFIX (orders/inventory/quiz_history 42501 on logout, surviving even
       * flushPendingUpload()): _setupRealtimeSignals() opens two channels —
       * 'eduquest-signals' (_signalChannel) and 'eduquest-table-sync'
       * (_tableSyncChannel) — that live for the whole tab session and were
       * NEVER unsubscribed anywhere, including on logout. A postgres_changes
       * event on any watched table (orders/inventory/quiz_history included)
       * calls _schedulePullRefresh(), which — once its 400ms debounce fires —
       * calls syncFromLegacy(), which ends in _persist() -> DBService.write()
       * -> _queueUpload(), queuing a NEW push. If that happens after
       * doLogout()'s one-time flushPendingUpload() already ran, the new push
       * is invisible to it and fires later, post-signOut(), 42501-ing exactly
       * like the original race. Call this — BEFORE flushing/signing out — so
       * nothing can re-dirty state through this path during that window.
       * Safe to call even if no channel was ever set up (e.g. offline mode).
       */
      teardownRealtime: function() {
        const client = _getClient();
        if (client) {
          try {
            if (_signalChannel) client.removeChannel(_signalChannel);
          } catch (e) {
            console.warn("[DBService] teardownRealtime: removeChannel(_signalChannel) failed:", e);
          }
          try {
            if (_tableSyncChannel) client.removeChannel(_tableSyncChannel);
          } catch (e) {
            console.warn("[DBService] teardownRealtime: removeChannel(_tableSyncChannel) failed:", e);
          }
        }
        _signalChannel = null;
        _tableSyncChannel = null;
        _meta.signalChannelReady = false;
        if (_pullRefreshTimer) {
          clearTimeout(_pullRefreshTimer);
          _pullRefreshTimer = null;
        }
        _pendingRefreshTables = /* @__PURE__ */ new Set();
      },
      /**
       * flushPendingUpload() → Promise<void>
       * BUGFIX (42501 RLS errors on logout, e.g. orders/quizzes/campaign_worlds/
       * inventory/point_log/quiz_history/redemptions): _queueUpload()'s 400ms
       * debounce means a state change made in the moments right before logout
       * can still be sitting in the timer queue when doLogout() calls
       * client.auth.signOut(). The timer keeps running during that await; if
       * it fires (or a push is already mid-flight) around the same moment the
       * session gets revoked, the upsert calls land with no valid auth.uid()
       * and every ownership-scoped RLS policy correctly rejects them.
       *
       * Call this — and await it — BEFORE signOut(), so any pending push
       * either completes (or fails loudly) while the session is still valid,
       * instead of racing teardown. No-op if nothing is queued.
       */
      flushPendingUpload: async function() {
        if (_uploadTimer) {
          clearTimeout(_uploadTimer);
          _uploadTimer = null;
          await _flushUpload(_sessionEpoch);
        }
      },
      /**
       * remove() → void
       * Hard-reset: clears local cache + mirror. Does NOT delete remote rows
       * (that is a destructive admin action, intentionally not exposed here —
       * use the Supabase dashboard or a dedicated admin RPC).
       */
      remove: function() {
        _cache = null;
        _sessionEpoch++;
        if (_uploadTimer) {
          clearTimeout(_uploadTimer);
          _uploadTimer = null;
        }
        try {
          _localStorageProvider.remove();
        } catch (e) {
        }
      },
      get storageKey() {
        return _localStorageProvider.key;
      },
      diagnostics: function() {
        return Object.assign({}, _meta);
      },
      /**
       * rpc(name, params) → Promise<{data, error}>
       * Thin pass-through to supabase.rpc(), for the trust-sensitive write
       * paths that must NOT go through the bulk write() upsert — loot claims
       * and achievement claims. See migration-strategy.md "Write paths that
       * MUST use RPCs" for the exact call-site edits in loot-service.js and
       * ach_engine.js (the only two files that need to change beyond this one
       * and state-manager.js).
       */
      rpc: async function(name, params) {
        const client = _getClient();
        if (!client) return { data: null, error: new Error("Supabase client not available (offline).") };
        return client.rpc(name, params);
      },
      /**
       * uploadPublicFile(bucket, path, blob, contentType) → Promise<{data, error}>
       * (Pending Fixes Report §2b — Boss Studio artwork storage)
       *
       * Narrow, documented crack in the "DBService is the only thing that
       * touches the Supabase client" rule — same posture as rpc() and
       * getAuthClient() above, just for Storage instead of Postgres/Auth.
       * Callers (bs_storage.js) never touch `.storage` directly; they only
       * ever call this method, so the client stays fully encapsulated here.
       *
       * Uploads with upsert:true (re-uploading the same ref is a no-op/replace,
       * never a duplicate-key error), then resolves the public URL. Returns
       * { data: { path, publicUrl }, error: null } on success, or
       * { data: null, error } — callers treat a failure as best-effort and
       * fall back to whatever local-only behavior existed before this file
       * existed (see bs_storage.js's _bsUploadArtworkToStorage()).
       */
      uploadPublicFile: async function(bucket, path, blob, contentType) {
        const client = _getClient();
        if (!client) return { data: null, error: new Error("Supabase client not available (offline).") };
        try {
          const { data, error } = await client.storage.from(bucket).upload(path, blob, {
            contentType: contentType || blob && blob.type || "application/octet-stream",
            upsert: true
          });
          if (error) return { data: null, error };
          const { data: pub } = client.storage.from(bucket).getPublicUrl(data.path);
          return { data: { path: data.path, publicUrl: pub.publicUrl }, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      },
      /**
       * getAuthClient() → SupabaseClient | null
       * AUTH MIGRATION: exposes the underlying Supabase client SOLELY for
       * calling its `.auth` namespace (signInWithPassword, signOut, getSession,
       * onAuthStateChange, etc.) from auth.js and — as of chunk A4, see
       * recovery.js — from the password-recovery listener/screen, which is
       * the same category of session-flow code as auth.js, just split into
       * its own file. This is the one intentional crack in the "DBService is
       * the only thing that touches the Supabase client" rule — auth state
       * doesn't belong to the cache/sync model (read/write/rpc) this file
       * otherwise owns, so it gets its own narrow accessor instead of being
       * bolted onto rpc(). Callers must still never call .from(...) directly
       * on this client — that stays exclusively DBService's job. Anything
       * that is NOT a login/session/recovery flow (e.g. an admin triggering a
       * reset email for someone else, see sendPasswordResetEmail() below)
       * goes through a dedicated DBService method instead of this accessor.
       */
      getAuthClient: function() {
        return _getClient();
      },
      /**
       * sendPasswordResetEmail(email, redirectTo) → Promise<{ok, error?}>
       * (Chunk A4 — Teacher Directory "Send Reset Email" action.)
       * Narrow, documented crack in the "DBService is the only thing that
       * touches the Supabase client" rule, same posture as uploadPublicFile()
       * above — this is the one non-session-flow caller allowed to reach
       * .auth, because unlike getAuthClient()'s callers (auth.js, recovery.js)
       * this isn't managing the CALLER's own session; it's an admin asking
       * Supabase to email a DIFFERENT account a recovery link. Kept out of
       * TeacherDirectoryService's direct reach of the raw client for that
       * reason. No RPC involved — resetPasswordForEmail() is a Supabase Auth
       * (GoTrue) call, not a Postgres one, so this can't be rpc().
       */
      sendPasswordResetEmail: async function(email, redirectTo) {
        const client = _getClient();
        if (!client) return { ok: false, error: "Supabase client not available (offline)." };
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return { ok: false, error: error.message || "Could not send the reset email." };
        return { ok: true };
      },
      /**
       * onSignal(eventName, fn) → void
       * Subscribe to a realtime broadcast signal (replaces the old
       * DB.pendingSkill / DB.pendingBossSummon polling fields).
       */
      onSignal: function(eventName, fn) {
        if (!_signalSubscribers[eventName]) _signalSubscribers[eventName] = [];
        _signalSubscribers[eventName].push(fn);
      },
      /**
       * sendSignal(eventName, payload) → void
       * Broadcast a one-off signal to all other connected tabs/devices.
       */
      sendSignal: function(eventName, payload) {
        if (_signalChannel) {
          _signalChannel.send({ type: "broadcast", event: eventName, payload });
        }
      },
      /**
       * loadMoreHistory(cacheKey, pageSize?) → Promise<{added, exhausted}>
       * Priority 2 Fix 2 follow-up — pages a bounded-history table (see
       * _HISTORY_LIMITS) further back than its default window. cacheKey is
       * one of: pointLog, redemptions, recitationLog, attendanceLogs, orders,
       * notifications. Not wired into any screen yet; exposed here so a
       * future "load older…" button is a small UI addition, not a
       * DBService change. Appends into _cache[cacheKey] and re-syncs
       * AppStore, same as a realtime refresh would.
       */
      loadMoreHistory: async function(cacheKey, pageSize) {
        return _loadMoreHistory(cacheKey, pageSize);
      },
      _meta,
      // Test-only seam (Phase 5A). Not used by any runtime call site — every
      // real push still goes through _flushUpload()/_getClient() exactly as
      // before. Exists so unit tests can drive _pushCacheToSupabase() and the
      // repository layer directly against a fake Supabase client, to assert
      // the refactor's upsert payloads are byte-identical to the pre-refactor
      // hand-written blocks, and (going forward, Phase 5B) to assert the
      // no-clobber property table-by-table before each is converted to delta
      // sync.
      _test: {
        pushCacheToSupabase: _pushCacheToSupabase,
        tableSyncConfigs: TableSyncRepository.tableSyncConfigs
      }
    };
  })();
  window.DBService = DBService2;

  // src/student-stats.js
  var TIER_THRESHOLDS = [
    { minLevel: 20, name: "Legend" },
    { minLevel: 15, name: "Master" },
    { minLevel: 10, name: "Scholar" },
    { minLevel: 5, name: "Achiever" },
    { minLevel: 0, name: "Novice" }
  ];
  function recalcStudentStats(student, opts) {
    if (!student) return;
    opts = opts || {};
    window.XP_PER_LEVEL = 1e3;
    window.getLevel = function(xp) {
      return Math.floor(xp / XP_PER_LEVEL);
    };
    for (const t of TIER_THRESHOLDS) {
      if (student.level >= t.minLevel) {
        student.tier = t.name;
        break;
      }
    }
    const history = (DB.quizHistory || {})[student.id] || [];
    if (history.length > 0) {
      const sum = history.reduce((acc, entry) => acc + (entry.score || 0), 0);
      student.quizAvg = Math.round(sum / history.length);
    }
    const logs = (opts.attendanceLogs || DB.attendanceLogs || []).filter((l) => l.studentId === student.id && l.status !== "Excused");
    if (logs.length > 0) {
      const present = logs.filter((l) => l.status === "Early" || l.status === "On Time" || l.status === "Late").length;
      student.attendance = Math.round(present / logs.length * 100);
    } else {
      const sessions = (DB.attendanceSessions || []).filter((s) => s.studentId === student.id);
      if (sessions.length > 0) {
        const present = sessions.filter((s) => s.status === "present").length;
        student.attendance = Math.round(present / sessions.length * 100);
      }
    }
  }
  window.recalcStudentStats = recalcStudentStats;
  function getStudentAttendanceRecords(sid, opts) {
    opts = opts || {};
    const logs = opts.attendanceLogs || DB.attendanceLogs || [];
    return logs.filter((r) => r.studentId === sid && r.status !== "Excused").map((r) => ({
      studentId: r.studentId,
      date: r.logDate,
      status: r.status === "Early" || r.status === "On Time" || r.status === "Late" ? "present" : "absent"
    }));
  }
  window.getStudentAttendanceRecords = getStudentAttendanceRecords;
  function computeAttendanceStreak(records) {
    const presentDays = [...new Set(
      records.filter((s) => s.status === "present").map((s) => s.date)
    )].sort();
    if (!presentDays.length) return { current: 0, longest: 0 };
    function parseDate(d) {
      if (!d) return null;
      const t = new Date(d);
      return isNaN(t.getTime()) ? null : t;
    }
    let longest = 1, cur = 1;
    for (let i = 1; i < presentDays.length; i++) {
      const a = parseDate(presentDays[i - 1]), b = parseDate(presentDays[i]);
      if (a && b) {
        const diff = Math.round((b - a) / 864e5);
        if (diff === 1) {
          cur++;
          longest = Math.max(longest, cur);
        } else cur = 1;
      }
    }
    const todayDate = /* @__PURE__ */ new Date();
    todayDate.setHours(0, 0, 0, 0);
    let curStreak = 0;
    const daysCopy = [...presentDays].reverse();
    let checkDate = new Date(todayDate);
    for (const d of daysCopy) {
      const pd = parseDate(d);
      if (!pd) continue;
      const diff = Math.round((checkDate - pd) / 864e5);
      if (diff === 0 || diff === 1) {
        curStreak++;
        checkDate = pd;
      } else if (diff > 1) break;
    }
    return { current: curStreak, longest: Math.max(longest, curStreak) };
  }
  window.computeAttendanceStreak = computeAttendanceStreak;
  function syncStudentStatsToServer(studentId, xpDelta, coinsDelta) {
    if (!studentId) return;
    xpDelta = xpDelta || 0;
    coinsDelta = coinsDelta || 0;
    if (!xpDelta && !coinsDelta) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("adjust_student_stats", {
      p_student_id: studentId,
      p_xp_delta: xpDelta,
      p_coins_delta: coinsDelta
    }).then(function(result) {
      const error = result && result.error;
      const data = result && result.data;
      if (error) {
        console.warn("[EduQuest] syncStudentStatsToServer: RPC failed for", studentId, error);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      try {
        if (typeof currentUser !== "undefined" && currentUser && currentUser.id === studentId) {
          currentUser.xp = row.xp;
          currentUser.coins = row.coins;
          currentUser.level = row.level;
          currentUser.tier = row.tier;
        }
      } catch (e) {
      }
      try {
        if (typeof AppStore !== "undefined" && AppStore && typeof AppStore.updateState === "function") {
          AppStore.updateState((draft) => {
            const s = (draft.students || []).find((x) => x.id === studentId);
            if (s) {
              s.xp = row.xp;
              s.coins = row.coins;
              s.level = row.level;
              s.tier = row.tier;
            }
          }, { type: "student:stats-synced", payload: { studentId } });
        }
      } catch (e) {
      }
    }).catch(function(e) {
      console.warn("[EduQuest] syncStudentStatsToServer: RPC threw for", studentId, e);
    });
  }
  window.syncStudentStatsToServer = syncStudentStatsToServer;
  async function syncOwnProfileCosmeticToServer(payload) {
    payload = payload || {};
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") {
      return { success: false, error: new Error("Not connected to Supabase (offline).") };
    }
    try {
      const result = await DBService2.rpc("update_own_profile_cosmetic", {
        p_display_name: payload.displayName !== void 0 ? payload.displayName : null,
        p_first_name: payload.firstName !== void 0 ? payload.firstName : null,
        p_last_name: payload.lastName !== void 0 ? payload.lastName : null,
        p_init: payload.init !== void 0 ? payload.init : null,
        p_profile_pic_url: payload.profilePic !== void 0 ? payload.profilePic : null
      });
      if (result && result.error) {
        console.warn("[EduQuest] syncOwnProfileCosmeticToServer: RPC failed", result.error);
        return { success: false, error: result.error };
      }
      return { success: true, row: result && result.data };
    } catch (e) {
      console.warn("[EduQuest] syncOwnProfileCosmeticToServer: RPC threw", e);
      return { success: false, error: e };
    }
  }
  window.syncOwnProfileCosmeticToServer = syncOwnProfileCosmeticToServer;
  function syncStudentDerivedStatsToServer(studentId, attendancePct, quizAvg) {
    if (!studentId) return;
    if (attendancePct === void 0 && quizAvg === void 0) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("sync_student_derived_stats", {
      p_student_id: studentId,
      p_attendance_pct: attendancePct === void 0 || attendancePct === null ? null : attendancePct,
      p_quiz_avg: quizAvg === void 0 || quizAvg === null ? null : quizAvg
    }).then(function(result) {
      const error = result && result.error;
      if (error) {
        console.warn("[EduQuest] syncStudentDerivedStatsToServer: RPC failed for", studentId, error);
      }
    }).catch(function(e) {
      console.warn("[EduQuest] syncStudentDerivedStatsToServer: RPC threw for", studentId, e);
    });
  }
  window.syncStudentDerivedStatsToServer = syncStudentDerivedStatsToServer;
  function syncAchievementUnlockToServer(studentId, achId, xpGranted, coinsGranted, claimed, classId) {
    if (!studentId || !achId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("award_achievement_to_student", {
      p_student_id: studentId,
      p_achievement_id: achId,
      p_xp_granted: xpGranted || 0,
      p_coins_granted: coinsGranted || 0,
      p_claimed: !!claimed,
      p_class_id: classId || null
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncAchievementUnlockToServer: RPC failed for", studentId, achId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncAchievementUnlockToServer: RPC threw for", studentId, achId, e);
    });
  }
  window.syncAchievementUnlockToServer = syncAchievementUnlockToServer;
  function syncAchievementClaimToServer(studentId, achId, xpGranted, coinsGranted) {
    if (!studentId || !achId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("claim_achievement_reward", {
      p_student_id: studentId,
      p_achievement_id: achId,
      p_xp_granted: xpGranted || 0,
      p_coins_granted: coinsGranted || 0
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncAchievementClaimToServer: RPC failed for", studentId, achId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncAchievementClaimToServer: RPC threw for", studentId, achId, e);
    });
  }
  window.syncAchievementClaimToServer = syncAchievementClaimToServer;
  function syncAchievementRevokeToServer(studentId, achId) {
    if (!studentId || !achId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("revoke_achievement_from_student", {
      p_student_id: studentId,
      p_achievement_id: achId
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncAchievementRevokeToServer: RPC failed for", studentId, achId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncAchievementRevokeToServer: RPC threw for", studentId, achId, e);
    });
  }
  window.syncAchievementRevokeToServer = syncAchievementRevokeToServer;
  function syncTitleUnlockToServer(studentId, titleId, classId) {
    if (!studentId || !titleId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("unlock_title_for_student", {
      p_student_id: studentId,
      p_title_id: titleId,
      p_class_id: classId || null
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncTitleUnlockToServer: RPC failed for", studentId, titleId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncTitleUnlockToServer: RPC threw for", studentId, titleId, e);
    });
  }
  window.syncTitleUnlockToServer = syncTitleUnlockToServer;
  function syncTitleRevokeToServer(studentId, titleId) {
    if (!studentId || !titleId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("revoke_title_from_student", {
      p_student_id: studentId,
      p_title_id: titleId
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncTitleRevokeToServer: RPC failed for", studentId, titleId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncTitleRevokeToServer: RPC threw for", studentId, titleId, e);
    });
  }
  window.syncTitleRevokeToServer = syncTitleRevokeToServer;
  function syncEquippedTitleToServer(studentId, titleId) {
    if (!studentId) return;
    if (typeof DBService2 === "undefined" || typeof DBService2.rpc !== "function") return;
    DBService2.rpc("set_equipped_title", {
      p_student_id: studentId,
      p_title_id: titleId || null
    }).then(function(result) {
      const error = result && result.error;
      if (error) console.warn("[EduQuest] syncEquippedTitleToServer: RPC failed for", studentId, titleId, error);
    }).catch(function(e) {
      console.warn("[EduQuest] syncEquippedTitleToServer: RPC threw for", studentId, titleId, e);
    });
  }
  window.syncEquippedTitleToServer = syncEquippedTitleToServer;

  // src/modules/recitation/progress.js
  (function injectProgressCSS() {
    if (document.getElementById("recitation-progress-css")) return;
    const style = document.createElement("style");
    style.id = "recitation-progress-css";
    style.textContent = `
/* \u2500\u2500 PROGRESS PAGE BASE \u2500\u2500 */
.prog-hero{
  position:relative;overflow:hidden;border-radius:20px;
  background:linear-gradient(135deg,#0f0d1f 0%,#1a1438 50%,#0e1a2a 100%);
  border:1px solid rgba(208,188,255,0.15);
  padding:36px 40px 32px;margin-bottom:28px;
}
.prog-hero::before{
  content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at 75% 50%,rgba(78,222,163,0.10) 0%,transparent 55%),
             radial-gradient(ellipse at 20% 80%,rgba(208,188,255,0.10) 0%,transparent 50%);
  pointer-events:none;
}
.prog-hero-grid{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;position:relative;z-index:1}
.prog-hero-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(78,222,163,.7);margin-bottom:6px}
.prog-hero-name{font-family:var(--fh);font-size:36px;font-weight:900;letter-spacing:-.5px;color:var(--on-surface);line-height:1.1;margin-bottom:4px}
.prog-hero-sub{font-size:13px;color:var(--text-muted);margin-bottom:18px}
.prog-stat-strip{display:flex;gap:10px;flex-wrap:wrap}
.prog-stat-chip{
  display:flex;flex-direction:column;align-items:center;padding:10px 16px;
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);
  border-radius:12px;min-width:80px;backdrop-filter:blur(8px);
}
.prog-stat-chip .v{font-family:var(--fh);font-size:22px;font-weight:900;line-height:1}
.prog-stat-chip .l{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-top:3px}
.prog-hero-avatar{
  width:90px;height:90px;border-radius:18px;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-size:28px;font-weight:900;
  box-shadow:0 0 40px rgba(139,92,246,0.3);
  border:2px solid rgba(208,188,255,0.25);flex-shrink:0;
}

/* \u2500\u2500 TAB BAR \u2500\u2500 */
.prog-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:28px;overflow-x:auto}
.prog-tab{
  display:flex;align-items:center;gap:7px;padding:12px 22px;
  font-size:13px;font-weight:700;letter-spacing:.04em;
  color:var(--text-muted);background:none;border:none;cursor:pointer;
  border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;
  font-family:var(--fb);
}
.prog-tab:hover{color:var(--on-surface)}
.prog-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.prog-tab .material-symbols-outlined{font-size:16px}
.prog-panel{display:none}
.prog-panel.active{display:block}

/* \u2500\u2500 STREAK CARDS \u2500\u2500 */
.streak-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:28px}
.streak-card{
  position:relative;overflow:hidden;
  border-radius:16px;padding:22px;
  background:rgba(35,31,56,0.85);
  border:1px solid var(--border);
  backdrop-filter:blur(12px);
  transition:all .3s;
}
.streak-card:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.streak-card.fire{border-color:rgba(255,185,95,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(40,25,10,.6))}
.streak-card.fire::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(255,185,95,.18) 0%,transparent 70%);border-radius:50%}
.streak-card.crystal{border-color:rgba(78,222,163,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(10,30,25,.6))}
.streak-card.crystal::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(78,222,163,.15) 0%,transparent 70%);border-radius:50%}
.streak-card.violet{border-color:rgba(208,188,255,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,10,40,.6))}
.streak-card.violet::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(208,188,255,.12) 0%,transparent 70%);border-radius:50%}
.streak-icon{font-size:36px;margin-bottom:10px;line-height:1;display:block}
.streak-num{font-family:var(--fh);font-size:48px;font-weight:900;line-height:1;margin-bottom:2px}
.streak-lbl{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.streak-sub{font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5}
.streak-badge{
  display:inline-flex;align-items:center;gap:5px;margin-top:10px;
  padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
}

/* \u2500\u2500 CALENDAR \u2500\u2500 */
.cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.cal-nav-btn{
  width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,.05);
  border:1px solid var(--border2);cursor:pointer;color:var(--on-surface);
  display:flex;align-items:center;justify-content:center;transition:all .18s;font-size:16px;
}
.cal-nav-btn:hover{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.3)}
.cal-month-label{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)}
.cal-grid-wrap{background:rgba(35,31,56,0.8);border:1px solid var(--border);border-radius:16px;overflow:hidden;backdrop-filter:blur(12px)}
.cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border)}
.cal-dow{padding:10px;text-align:center;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.cal-days-grid{display:grid;grid-template-columns:repeat(7,1fr)}
.cal-day{
  position:relative;aspect-ratio:1;padding:6px;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  cursor:default;transition:all .18s;border-right:1px solid rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.03);
}
.cal-day.has-data{cursor:pointer}
.cal-day.has-data:hover{background:rgba(208,188,255,.07)}
.cal-day.today .cal-day-num{background:var(--primary-dark);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center}
.cal-day-num{font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:3px;line-height:1}
.cal-day.present .cal-day-num{color:var(--secondary)}
.cal-day.absent .cal-day-num{color:var(--error)}
.cal-day.empty{opacity:.25}
.cal-day-dots{display:flex;flex-wrap:wrap;gap:2px;justify-content:center;margin-top:2px}
.cal-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.cal-dot.present{background:var(--secondary);box-shadow:0 0 4px rgba(78,222,163,.6)}
.cal-dot.absent{background:var(--error);box-shadow:0 0 4px rgba(255,180,171,.6)}
.cal-dot.recitation{background:var(--primary);box-shadow:0 0 4px rgba(208,188,255,.6)}
.cal-dot.quiz{background:var(--tertiary);box-shadow:0 0 4px rgba(255,185,95,.6)}
.cal-day-detail{
  background:rgba(28,25,48,0.98);border:1px solid rgba(208,188,255,.2);
  border-radius:16px;padding:20px;margin-top:16px;
  box-shadow:0 0 32px rgba(139,92,246,.15);
  animation:fadeIn .2s ease;display:none;
}
.cal-day-detail.open{display:block}
.cal-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding:12px 16px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--border)}
.cal-leg-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);font-weight:600}

/* \u2500\u2500 RECITATION HISTORY \u2500\u2500 */
.rec-timeline{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}
.rec-entry{
  display:flex;align-items:flex-start;gap:14px;padding:14px 16px;
  background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:12px;
  transition:all .2s;backdrop-filter:blur(8px);position:relative;overflow:hidden;
}
.rec-entry::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--secondary);border-radius:3px 0 0 3px}
.rec-entry.high-pts::before{background:var(--primary)}
.rec-entry.epic-pts::before{background:var(--tertiary)}
.rec-entry:hover{border-color:rgba(78,222,163,.25);transform:translateX(2px)}
.rec-entry-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.25)}
.rec-entry-icon.high{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.25)}
.rec-entry-icon.epic{background:rgba(255,185,95,.1);border-color:rgba(255,185,95,.25)}
.rec-entry-body{flex:1;min-width:0}
.rec-entry-pts{font-family:var(--fh);font-size:20px;font-weight:900}
.rec-entry-note{font-size:13px;color:var(--text-muted);margin-top:2px;line-height:1.4}
.rec-entry-when{font-size:10px;color:rgba(255,255,255,.3);margin-top:4px;font-weight:600;letter-spacing:.04em}
.rec-entry-rank{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;white-space:nowrap;flex-shrink:0;margin-top:4px}

/* \u2500\u2500 MILESTONE CARDS \u2500\u2500 */
.milestone-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:28px}
.ms-card{
  border-radius:14px;padding:18px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;position:relative;overflow:hidden;
}
.ms-card.unlocked{border-color:rgba(255,185,95,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(30,20,5,.7))}
.ms-card.unlocked::after{content:'\u2713';position:absolute;top:10px;right:12px;font-size:16px;font-weight:900;color:var(--tertiary)}
.ms-card.locked{opacity:.55}
.ms-card:hover:not(.locked){transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.4)}
.ms-icon{font-size:32px;margin-bottom:8px;display:block;line-height:1}
.ms-title{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:4px}
.ms-desc{font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:8px}
.ms-progress{background:rgba(255,255,255,.06);border-radius:20px;height:4px;overflow:hidden}
.ms-progress-fill{height:100%;border-radius:20px;transition:width .8s ease}

/* \u2500\u2500 SHOWCASE / TROPHY ROOM \u2500\u2500 */
.showcase-header{
  text-align:center;padding:32px;
  background:linear-gradient(135deg,rgba(25,20,50,.95),rgba(15,25,20,.9));
  border:1px solid rgba(208,188,255,.15);border-radius:20px;margin-bottom:24px;
  position:relative;overflow:hidden;
}
.showcase-header::before{content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at 50% 0%,rgba(208,188,255,.12) 0%,transparent 60%);pointer-events:none}
.showcase-crown{font-size:56px;display:block;margin-bottom:8px;line-height:1;animation:floatCrown 3s ease-in-out infinite}
@keyframes floatCrown{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.showcase-title-text{font-family:var(--fm);font-size:22px;font-weight:900;letter-spacing:.1em;
  background:linear-gradient(135deg,#ffd700,#ffb95f,#d0bcff);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  margin-bottom:4px}
.showcase-sub{font-size:13px;color:var(--text-muted)}

.trophy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:28px}
.trophy-card{
  border-radius:16px;padding:20px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;
  display:flex;flex-direction:column;
}
.trophy-card.gold{border-color:rgba(255,215,0,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(30,22,5,.7))}
.trophy-card.silver{border-color:rgba(192,192,192,.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,20,25,.8))}
.trophy-card.bronze{border-color:rgba(205,127,50,.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(25,15,5,.7))}
.trophy-card.emerald{border-color:rgba(78,222,163,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(5,25,15,.7))}
.trophy-card.violet{border-color:rgba(208,188,255,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,10,40,.7))}
.trophy-card:hover{transform:translateY(-4px);box-shadow:0 14px 44px rgba(0,0,0,.5)}
.trophy-icon-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.trophy-icon{font-size:32px;line-height:1}
.trophy-grade{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:6px}
.trophy-card-title{font-family:var(--fh);font-size:15px;font-weight:900;color:var(--on-surface);margin-bottom:4px}
.trophy-card-value{font-family:var(--fh);font-size:28px;font-weight:900;line-height:1;margin-bottom:2px}
.trophy-card-sub{font-size:11px;color:var(--text-muted);line-height:1.5;flex:1}
.trophy-card-footer{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:var(--text-muted)}

/* \u2500\u2500 ATTENDANCE HISTORY TABLE \u2500\u2500 */
.att-hist-list{display:flex;flex-direction:column;gap:8px}
.att-hist-row{
  display:flex;align-items:center;gap:14px;padding:12px 16px;
  background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;
  transition:all .2s;backdrop-filter:blur(8px);
}
.att-hist-row:hover{border-color:rgba(255,255,255,.12);transform:translateX(2px)}
.att-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.att-status-dot.present{background:var(--secondary);box-shadow:0 0 8px rgba(78,222,163,.5)}
.att-status-dot.absent{background:var(--error);box-shadow:0 0 8px rgba(255,180,171,.5)}

/* \u2500\u2500 SHARE CARD STYLE \u2500\u2500 */
.share-card{
  background:linear-gradient(135deg,#12102a 0%,#1a1438 40%,#0c1a14 100%);
  border:1px solid rgba(208,188,255,.25);border-radius:20px;
  padding:28px;position:relative;overflow:hidden;margin-bottom:20px;
}
.share-card::before{content:'';position:absolute;top:-30px;right:-30px;width:160px;height:160px;
  background:radial-gradient(circle,rgba(208,188,255,.12) 0%,transparent 70%);border-radius:50%;pointer-events:none}
.share-card::after{content:'';position:absolute;bottom:-40px;left:10%;width:120px;height:120px;
  background:radial-gradient(circle,rgba(78,222,163,.10) 0%,transparent 70%);border-radius:50%;pointer-events:none}
.share-card-inner{position:relative;z-index:1}
.share-watermark{font-family:var(--fm);font-size:9px;letter-spacing:.16em;color:rgba(208,188,255,.35);text-transform:uppercase;margin-bottom:16px}
.share-student-row{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;margin-bottom:18px}
.share-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.share-stat{text-align:center;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px}
.share-stat .sv{font-family:var(--fh);font-size:20px;font-weight:900}
.share-stat .sl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700}
.share-badges-row{display:flex;gap:8px;flex-wrap:wrap}
.share-badge-chip{padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;display:flex;align-items:center;gap:4px}
`;
    document.head.appendChild(style);
  })();
  var PROG_ATTENDANCE_MILESTONES = [
    { id: "att_1", icon: "\u{1F5D3}\uFE0F", title: "First Attendance", desc: "Log your first attendance session", target: 1, field: "presentCount", color: "#4edea3" },
    { id: "att_5", icon: "\u{1F4C5}", title: "Week Warrior", desc: "Be present 5 times", target: 5, field: "presentCount", color: "#4edea3" },
    { id: "att_10", icon: "\u2728", title: "Consistent Scholar", desc: "Be present 10 times", target: 10, field: "presentCount", color: "#8b5cf6" },
    { id: "att_25", icon: "\u{1F31F}", title: "Dedicated Student", desc: "Be present 25 times", target: 25, field: "presentCount", color: "#ffb95f" },
    { id: "att_50", icon: "\u{1F3C6}", title: "Attendance Legend", desc: "Be present 50 times", target: 50, field: "presentCount", color: "#ffd700" },
    { id: "streak_3", icon: "\u{1F525}", title: "3-Day Streak", desc: "Attend 3 consecutive days", target: 3, field: "currentStreak", color: "#f97316" },
    { id: "streak_7", icon: "\u{1F525}", title: "Weekly Fire", desc: "Attend 7 consecutive days", target: 7, field: "currentStreak", color: "#ef4444" },
    { id: "streak_14", icon: "\u{1F4AB}", title: "Fortnight Flame", desc: "Maintain a 14-day streak", target: 14, field: "longestStreak", color: "#d0bcff" },
    { id: "streak_30", icon: "\u2B50", title: "Eternal Flame", desc: "30-day attendance streak", target: 30, field: "longestStreak", color: "#ffd700" },
    { id: "perfect_month", icon: "\u{1F48E}", title: "Perfect Month", desc: "Zero absences in a whole month", target: 1, field: "perfectMonths", color: "#4edea3" },
    { id: "perfect_months_3", icon: "\u{1F48E}\u{1F48E}", title: "Diamond Attendance", desc: "3 perfect attendance months", target: 3, field: "perfectMonths", color: "#a78bfa" }
  ];
  var PROG_RECITATION_MILESTONES = [
    { id: "rec_1", icon: "\u{1F3A4}", title: "First Word", desc: "Complete your first recitation", target: 1, field: "sessionCount", color: "#4edea3" },
    { id: "rec_5", icon: "\u{1F5E3}\uFE0F", title: "Active Participant", desc: "Complete 5 recitations", target: 5, field: "sessionCount", color: "#4edea3" },
    { id: "rec_10", icon: "\u{1F4E2}", title: "Vocal Scholar", desc: "Complete 10 recitations", target: 10, field: "sessionCount", color: "#8b5cf6" },
    { id: "rec_25", icon: "\u{1F399}\uFE0F", title: "Voice of Class", desc: "Complete 25 recitations", target: 25, field: "sessionCount", color: "#ffb95f" },
    { id: "rec_50", icon: "\u{1F451}", title: "Recitation Master", desc: "50 recitation sessions", target: 50, field: "sessionCount", color: "#ffd700" },
    { id: "rec_pts_50", icon: "\u26A1", title: "50 Points Earned", desc: "Earn 50 recitation points", target: 50, field: "totalPts", color: "#4edea3" },
    { id: "rec_pts_150", icon: "\u26A1\u26A1", title: "Point Powerhouse", desc: "Earn 150 recitation points", target: 150, field: "totalPts", color: "#8b5cf6" },
    { id: "rec_pts_500", icon: "\u{1F4A5}", title: "Elite Contributor", desc: "Earn 500 recitation points total", target: 500, field: "totalPts", color: "#ffd700" },
    { id: "rec_streak_3", icon: "\u{1F3AF}", title: "3 Recitations in a Row", desc: "Recite on 3 consecutive class days", target: 3, field: "streak", color: "#f97316" },
    { id: "rec_streak_5", icon: "\u{1F3AF}", title: "Consistent Voice", desc: "Recite on 5 consecutive days", target: 5, field: "streak", color: "#ef4444" },
    { id: "rec_wins", icon: "\u{1F320}", title: "High Scorer", desc: "Earn 15+ pts in a single recitation", target: 1, field: "wins", color: "#ffb95f" },
    { id: "rec_wins_5", icon: "\u{1F320}\u{1F320}", title: "Consistent Excellence", desc: "Earn 15+ pts 5 times", target: 5, field: "wins", color: "#ffd700" }
  ];
  var progCalYear = (/* @__PURE__ */ new Date()).getFullYear();
  var progCalMonth = (/* @__PURE__ */ new Date()).getMonth();
  var progActiveTab = "streaks";
  function progGetAttendanceForStudent(sid) {
    return getStudentAttendanceRecords(sid);
  }
  function progGetRecitationsForStudent(sid) {
    return (AppStore.getSlice((s) => s.recitationLog) || []).filter((r) => r.studentId === sid);
  }
  function progAttStreak(sessions) {
    return computeAttendanceStreak(sessions);
  }
  function progRecStreak(recitations) {
    const days = [...new Set(
      recitations.map((r) => (r.when || "").split(" ")[0] || r.when || "").filter(Boolean)
    )].sort();
    if (!days.length) return { current: 0, longest: 0 };
    let longest = 1, cur = 1;
    function pd(d) {
      const t = new Date(d);
      return isNaN(t.getTime()) ? null : t;
    }
    for (let i = 1; i < days.length; i++) {
      const a = pd(days[i - 1]), b = pd(days[i]);
      if (a && b) {
        const diff = Math.round((b - a) / 864e5);
        if (diff <= 1) {
          cur++;
          longest = Math.max(longest, cur);
        } else cur = 1;
      }
    }
    const todayDate = /* @__PURE__ */ new Date();
    todayDate.setHours(0, 0, 0, 0);
    let curStreak = 0;
    const rev = [...days].reverse();
    let check = new Date(todayDate);
    for (const d of rev) {
      const pd2 = pd(d);
      if (!pd2) continue;
      const diff = Math.round((check - pd2) / 864e5);
      if (diff === 0 || diff === 1) {
        curStreak++;
        check = pd2;
      } else if (diff > 1) break;
    }
    return { current: curStreak, longest: Math.max(longest, curStreak) };
  }
  function progPerfectMonths(sessions) {
    const byMonth = {};
    sessions.forEach((s) => {
      if (!s.date) return;
      const d = new Date(s.date);
      if (isNaN(d)) return;
      const key = d.getFullYear() + "-" + (d.getMonth() + 1);
      if (!byMonth[key]) byMonth[key] = { present: 0, absent: 0 };
      s.status === "present" ? byMonth[key].present++ : byMonth[key].absent++;
    });
    return Object.values(byMonth).filter((m) => m.absent === 0 && m.present > 0).length;
  }
  function progBuildCalendar(sid, year, month) {
    const attendance = progGetAttendanceForStudent(sid);
    const recitations = progGetRecitationsForStudent(sid);
    const quizLog = (AppStore.getSlice((s) => s.pointLog) || []).filter((l) => l.studentId === sid && (l.what || "").startsWith("Quest:"));
    const data = {};
    attendance.forEach((a) => {
      if (!a.date) return;
      const d = new Date(a.date);
      if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
      const key = d.getDate();
      if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
      data[key].status = a.status;
    });
    recitations.forEach((r) => {
      if (!r.when) return;
      const d = new Date(r.when);
      if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
      const key = d.getDate();
      if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
      data[key].recitations.push(r);
    });
    quizLog.forEach((q) => {
      if (!q.when) return;
      const d = new Date(q.when);
      if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
      const key = d.getDate();
      if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
      data[key].quizzes.push(q);
    });
    return data;
  }
  function progRenderStreaks(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, absentCount, attPct) {
    const totalSess = attendanceSess.length;
    const attBar = Math.min(100, attPct);
    return `
  <div class="streak-grid">
    <div class="streak-card fire">
      <span class="streak-icon">\u{1F525}</span>
      <div class="streak-num" style="color:#ffb95f">${attStreaks.current}</div>
      <div class="streak-lbl">Attendance Streak</div>
      <div class="streak-sub">Consecutive days present<br>Longest ever: <strong style="color:#fff">${attStreaks.longest} days</strong></div>
      ${attStreaks.current >= 3 ? `<span class="streak-badge" style="background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.35);color:#ffb95f">\u{1F525} On Fire</span>` : ""}
      ${attStreaks.current >= 7 ? `<span class="streak-badge" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#f87171;margin-left:4px">\u{1F3C5} Weekly Hero</span>` : ""}
    </div>
    <div class="streak-card crystal">
      <span class="streak-icon">\u{1F3A4}</span>
      <div class="streak-num" style="color:#4edea3">${recStreaks.current}</div>
      <div class="streak-lbl">Recitation Streak</div>
      <div class="streak-sub">Consecutive class days recited<br>Best ever: <strong style="color:#fff">${recStreaks.longest} days</strong></div>
      ${recStreaks.current >= 3 ? `<span class="streak-badge" style="background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.35);color:#4edea3">\u{1F3AF} Active Voice</span>` : ""}
    </div>
    <div class="streak-card violet">
      <span class="streak-icon">\u{1F48E}</span>
      <div class="streak-num" style="color:#d0bcff">${perfectMonths}</div>
      <div class="streak-lbl">Perfect Months</div>
      <div class="streak-sub">Months with zero absences<br>${perfectMonths === 0 ? "Work toward your first!" : "Keep going, you're amazing!"}</div>
      ${perfectMonths >= 1 ? `<span class="streak-badge" style="background:rgba(208,188,255,.15);border:1px solid rgba(208,188,255,.35);color:#d0bcff">\u{1F48E} Diamond Scholar</span>` : ""}
    </div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">calendar_today</span>
    <h2>Attendance Overview</h2>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px">
    <div class="glass-card" style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Attendance Rate</div>
          <div style="font-family:var(--fh);font-size:40px;font-weight:900;color:${attPct >= 90 ? "#4edea3" : attPct >= 75 ? "#ffb95f" : "#ffb4ab"};line-height:1">${attPct}%</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted)">Present</div>
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#4edea3">${presentCount}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Absent</div>
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#ffb4ab">${absentCount}</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;height:10px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;border-radius:20px;width:${attBar}%;background:linear-gradient(90deg,#4edea3,#06b6d4);box-shadow:0 0 10px rgba(78,222,163,.5);transition:width .8s ease"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">Total sessions recorded: ${totalSess}</div>
    </div>
    <div class="glass-card" style="padding:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px">Recitation Summary</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[
      { v: recStats.sessionCount || recitations.length, l: "Sessions", c: "#d0bcff" },
      { v: recStats.totalPts || 0, l: "Total Pts", c: "#4edea3" },
      { v: recStats.streak || recStreaks.longest, l: "Best Streak", c: "#f97316" },
      { v: recStats.wins || 0, l: "High Scores", c: "#ffd700" }
    ].map((s) => `
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px">
          <div style="font-family:var(--fh);font-size:28px;font-weight:900;color:${s.c}">${s.v}</div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700">${s.l}</div>
        </div>`).join("")}
      </div>
    </div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">history</span>
    <h2>Recent Attendance</h2>
    <span class="badge-pill bp-primary">${attendanceSess.length} records</span>
  </div>
  <div class="att-hist-list">
    ${attendanceSess.length ? attendanceSess.slice(0, 12).map((a) => `
    <div class="att-hist-row">
      <div class="att-status-dot ${a.status}"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:${a.status === "present" ? "#4edea3" : "#ffb4ab"}">${a.status === "present" ? "\u2705 Present" : "\u274C Absent"}</div>
        <div style="font-size:11px;color:var(--text-muted)">${a.date || "\u2014"}</div>
      </div>
      <div class="badge-pill ${a.status === "present" ? "bp-green" : "bp-red"}">${a.status === "present" ? "+5 coins" : "-5 coins"}</div>
    </div>`).join("") : `<div style="text-align:center;padding:48px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px;color:var(--text-muted)">
      <div style="font-size:40px;margin-bottom:10px">\u{1F4C5}</div>
      <div style="font-family:var(--fh);font-weight:800;margin-bottom:4px">No records yet</div>
      <div style="font-size:13px">Your attendance will appear here once your teacher logs it.</div>
    </div>`}
  </div>`;
  }
  function progRenderCalendarPanel(st) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const calData = progBuildCalendar(st.id, progCalYear, progCalMonth);
    const firstDay = new Date(progCalYear, progCalMonth, 1).getDay();
    const daysInMonth = new Date(progCalYear, progCalMonth + 1, 0).getDate();
    const todayD = /* @__PURE__ */ new Date();
    const isThisMonth = todayD.getFullYear() === progCalYear && todayD.getMonth() === progCalMonth;
    let dayCells = "";
    for (let i = 0; i < firstDay; i++) dayCells += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayData = calData[d];
      const hasData = !!(dayData && (dayData.status || dayData.recitations.length || dayData.quizzes.length));
      const isToday = isThisMonth && d === todayD.getDate();
      let cls = "cal-day";
      if (dayData?.status === "present") cls += " present";
      else if (dayData?.status === "absent") cls += " absent";
      if (isToday) cls += " today";
      if (hasData) cls += " has-data";
      const dots = [];
      if (dayData?.status === "present") dots.push('<span class="cal-dot present"></span>');
      else if (dayData?.status === "absent") dots.push('<span class="cal-dot absent"></span>');
      if (dayData?.recitations?.length) dots.push('<span class="cal-dot recitation"></span>');
      if (dayData?.quizzes?.length) dots.push('<span class="cal-dot quiz"></span>');
      dayCells += `<div class="${cls}" ${hasData ? `onclick="progShowCalDay(${d},${progCalYear},${progCalMonth})"` : ""}>
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-dots">${dots.join("")}</div>
    </div>`;
    }
    return `
  <div class="cal-header">
    <button class="cal-nav-btn" onclick="progCalNav(-1)">\u2039</button>
    <div class="cal-month-label">${months[progCalMonth]} ${progCalYear}</div>
    <button class="cal-nav-btn" onclick="progCalNav(1)">\u203A</button>
  </div>
  <div class="cal-grid-wrap">
    <div class="cal-dow-row">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
    </div>
    <div class="cal-days-grid">${dayCells}</div>
  </div>
  <div class="cal-legend">
    <div class="cal-leg-item"><span class="cal-dot present" style="width:8px;height:8px"></span>Present</div>
    <div class="cal-leg-item"><span class="cal-dot absent" style="width:8px;height:8px"></span>Absent</div>
    <div class="cal-leg-item"><span class="cal-dot recitation" style="width:8px;height:8px"></span>Recitation</div>
    <div class="cal-leg-item"><span class="cal-dot quiz" style="width:8px;height:8px"></span>Quiz</div>
  </div>
  <div class="cal-day-detail" id="cal-day-detail"></div>
  `;
  }
  function progRenderRecitationPanel(st, recitations, recStats, recStreaks) {
    const sorted = [...recitations].sort((a, b) => (b.pts || 0) - (a.pts || 0));
    const topPts = sorted[0]?.pts || 0;
    return `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:28px">
    ${[
      { v: recStats.sessionCount || recitations.length, l: "Total Sessions", c: "#d0bcff" },
      { v: recStats.totalPts || 0, l: "Total Points", c: "#4edea3" },
      { v: recStats.wins || 0, l: "High Scores (15+)", c: "#ffd700" },
      { v: recStreaks.longest, l: "Best Streak", c: "#f97316" },
      { v: topPts, l: "Best Single Score", c: "#ffb95f" },
      { v: recitations.length > 0 ? Math.round((recStats.totalPts || 0) / (recStats.sessionCount || recitations.length)) : 0, l: "Avg Points/Session", c: "#8b5cf6" }
    ].map((s) => `
    <div class="glass-card" style="padding:16px;text-align:center">
      <div style="font-family:var(--fh);font-size:28px;font-weight:900;color:${s.c}">${s.v}</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700;margin-top:4px">${s.l}</div>
    </div>`).join("")}
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">mic</span>
    <h2>Recitation Timeline</h2>
    <span class="badge-pill bp-green">${recitations.length} sessions</span>
  </div>

  ${recitations.length ? `
  <div class="rec-timeline">
    ${[...recitations].sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0)).map((r) => {
      const pts = r.pts || 0;
      const tier = pts >= 20 ? "epic" : pts >= 15 ? "high" : "normal";
      const icon = pts >= 20 ? "\u{1F31F}" : pts >= 15 ? "\u2B50" : "\u{1F3A4}";
      return `<div class="rec-entry ${tier === "high" ? "high-pts" : ""} ${tier === "epic" ? "epic-pts" : ""}">
        <div class="rec-entry-icon ${tier}"><span style="font-size:20px">${icon}</span></div>
        <div class="rec-entry-body">
          <div class="rec-entry-pts" style="color:${pts >= 20 ? "#ffd700" : pts >= 15 ? "#d0bcff" : "#4edea3"}">+${pts} pts</div>
          <div class="rec-entry-note">${_esc(r.note || "Recitation session")}</div>
          <div class="rec-entry-when">\u{1F550} ${r.when || "\u2014"}</div>
        </div>
        ${pts >= 20 ? `<span class="badge-pill bp-gold" style="font-size:10px">\u{1F31F} Epic</span>` : pts >= 15 ? `<span class="badge-pill bp-primary" style="font-size:10px">\u2B50 High Score</span>` : ""}
      </div>`;
    }).join("")}
  </div>` : `
  <div style="text-align:center;padding:64px 20px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px">
    <div style="font-size:48px;margin-bottom:12px">\u{1F3A4}</div>
    <div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface);margin-bottom:6px">No recitations yet</div>
    <div style="color:var(--text-muted);font-size:13px">Your recitation history will appear here. Speak up in class!</div>
  </div>`}`;
  }
  function progRenderMilestones(st, presentCount, attStreaks, recStats, perfectMonths) {
    const attFields = { presentCount, currentStreak: attStreaks.current, longestStreak: attStreaks.longest, perfectMonths };
    const recFields = { sessionCount: recStats.sessionCount || 0, totalPts: recStats.totalPts || 0, streak: recStats.streak || 0, wins: recStats.wins || 0 };
    function msCard(ms, fields) {
      const val = fields[ms.field] || 0;
      const pct = Math.min(100, Math.round(val / ms.target * 100));
      const unlocked = val >= ms.target;
      return `<div class="ms-card ${unlocked ? "unlocked" : "locked"}">
      <span class="ms-icon">${ms.icon}</span>
      <div class="ms-title">${ms.title}</div>
      <div class="ms-desc">${ms.desc}</div>
      <div class="ms-progress"><div class="ms-progress-fill" style="width:${pct}%;background:${ms.color};box-shadow:0 0 8px ${ms.color}55"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--text-muted);font-weight:700">
        <span>${val} / ${ms.target}</span><span>${pct}%</span>
      </div>
    </div>`;
    }
    const attUnlocked = PROG_ATTENDANCE_MILESTONES.filter((m) => (attFields[m.field] || 0) >= m.target).length;
    const recUnlocked = PROG_RECITATION_MILESTONES.filter((m) => (recFields[m.field] || 0) >= m.target).length;
    const total = PROG_ATTENDANCE_MILESTONES.length + PROG_RECITATION_MILESTONES.length;
    const totalUnlocked = attUnlocked + recUnlocked;
    return `
  <div class="glass-card" style="padding:18px;margin-bottom:24px;display:flex;align-items:center;gap:18px">
    <div style="font-size:48px">\u{1F3C6}</div>
    <div style="flex:1">
      <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface)">${totalUnlocked} / ${total} Milestones</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Keep pushing \u2014 every achievement counts!</div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;height:8px;overflow:hidden">
        <div style="height:100%;border-radius:20px;width:${Math.round(totalUnlocked / total * 100)}%;background:linear-gradient(90deg,#8b5cf6,#4edea3);box-shadow:0 0 10px rgba(139,92,246,.5)"></div>
      </div>
    </div>
    <div style="text-align:center;padding:12px 20px;background:rgba(255,185,95,.08);border:1px solid rgba(255,185,95,.2);border-radius:12px">
      <div style="font-family:var(--fh);font-size:32px;font-weight:900;color:#ffd700">${Math.round(totalUnlocked / total * 100)}%</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700">Complete</div>
    </div>
  </div>

  <div class="section-header"><span class="material-symbols-outlined">calendar_today</span><h2>Attendance Milestones</h2><span class="badge-pill bp-green">${attUnlocked}/${PROG_ATTENDANCE_MILESTONES.length} unlocked</span></div>
  <div class="milestone-grid">${PROG_ATTENDANCE_MILESTONES.map((m) => msCard(m, attFields)).join("")}</div>

  <div class="section-header"><span class="material-symbols-outlined">mic</span><h2>Recitation Milestones</h2><span class="badge-pill bp-primary">${recUnlocked}/${PROG_RECITATION_MILESTONES.length} unlocked</span></div>
  <div class="milestone-grid">${PROG_RECITATION_MILESTONES.map((m) => msCard(m, recFields)).join("")}</div>
  `;
  }
  function progRenderShowcase(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, attPct) {
    const unlocks = (AppStore.getSlice((s) => s.achievementUnlocks) || {})[st.id] || [];
    const allAchievements = AppStore.getSlice((s) => s.achievements) || [];
    const earnedAchs = unlocks.map((u) => allAchievements.find((a) => a.id === u.achId)).filter(Boolean);
    const allTitles = AppStore.getSlice((s) => s.titles) || [];
    const earnedTitles = (st.unlockedTitles || []).map((tid) => allTitles.find((t) => t.id === tid)).filter(Boolean);
    const sorted = [...AppStore.getSlice((s) => s.students) || []].sort((a, b) => b.xp - a.xp);
    const myRank = sorted.findIndex((s) => s.id === st.id) + 1;
    const trophies = [];
    if (attPct >= 100) trophies.push({ icon: "\u{1F48E}", grade: "LEGENDARY", gradeColor: "#4edea3", gradeBg: "rgba(78,222,163,.15)", title: "Perfect Attendance", value: `${attPct}%`, sub: "You have never missed a single class. A true legend.", variant: "emerald" });
    else if (attPct >= 95) trophies.push({ icon: "\u{1F3C6}", grade: "PLATINUM", gradeColor: "#d0bcff", gradeBg: "rgba(208,188,255,.15)", title: "Elite Attendance", value: `${attPct}%`, sub: "Exceptional dedication \u2014 only the most committed scholars achieve this.", variant: "violet" });
    else if (attPct >= 85) trophies.push({ icon: "\u2B50", grade: "GOLD", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: "Strong Attendance", value: `${attPct}%`, sub: "A reliable presence that teachers and classmates can count on.", variant: "gold" });
    else if (attPct > 0) trophies.push({ icon: "\u{1F4C5}", grade: "BRONZE", gradeColor: "#cd7f32", gradeBg: "rgba(205,127,50,.15)", title: "Attendance Record", value: `${attPct}%`, sub: "Building good attendance habits.", variant: "bronze" });
    if (attStreaks.longest >= 14) trophies.push({ icon: "\u{1F525}", grade: "EPIC", gradeColor: "#ef4444", gradeBg: "rgba(239,68,68,.15)", title: "Attendance Streak Record", value: `${attStreaks.longest} days`, sub: "Your best run of consecutive days present. Incredible discipline.", variant: "gold" });
    else if (attStreaks.longest >= 7) trophies.push({ icon: "\u{1F525}", grade: "RARE", gradeColor: "#f97316", gradeBg: "rgba(249,115,22,.15)", title: "Week-Long Streak", value: `${attStreaks.longest} days`, sub: "A full week of consecutive attendance. Keep building!", variant: "silver" });
    else if (attStreaks.longest >= 3) trophies.push({ icon: "\u{1F525}", grade: "COMMON", gradeColor: "#ffb95f", gradeBg: "rgba(255,185,95,.15)", title: "Attendance Streak", value: `${attStreaks.longest} days`, sub: "Your current best streak. Aim higher!", variant: "bronze" });
    if (perfectMonths >= 3) trophies.push({ icon: "\u{1F48E}", grade: "LEGENDARY", gradeColor: "#a78bfa", gradeBg: "rgba(167,139,250,.15)", title: "Diamond Attendance", value: `${perfectMonths} perfect months`, sub: "Three or more months of flawless attendance. Extraordinary commitment.", variant: "violet" });
    else if (perfectMonths >= 1) trophies.push({ icon: "\u{1F31F}", grade: "GOLD", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: "Perfect Month", value: `${perfectMonths} month${perfectMonths > 1 ? "s" : ""}`, sub: "Zero absences for an entire month. Outstanding achievement!", variant: "gold" });
    const sessCount = recStats.sessionCount || recitations.length;
    if (sessCount >= 25) trophies.push({ icon: "\u{1F451}", grade: "EPIC", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: "Recitation Master", value: `${sessCount} sessions`, sub: "25+ recitation sessions. A true voice of the classroom.", variant: "gold" });
    else if (sessCount >= 10) trophies.push({ icon: "\u{1F399}\uFE0F", grade: "RARE", gradeColor: "#4edea3", gradeBg: "rgba(78,222,163,.15)", title: "Vocal Scholar", value: `${sessCount} sessions`, sub: "10+ recitations completed. Your voice matters!", variant: "emerald" });
    else if (sessCount >= 1) trophies.push({ icon: "\u{1F3A4}", grade: "COMMON", gradeColor: "#4edea3", gradeBg: "rgba(78,222,163,.15)", title: "Active Participant", value: `${sessCount} sessions`, sub: "You've started your recitation journey. Keep it up!", variant: "silver" });
    const totalRecPts = recStats.totalPts || 0;
    if (totalRecPts >= 500) trophies.push({ icon: "\u{1F4A5}", grade: "LEGENDARY", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: "Recitation Elite", value: `${totalRecPts} pts`, sub: "500+ recitation points earned. An academic force to be reckoned with.", variant: "gold" });
    else if (totalRecPts >= 150) trophies.push({ icon: "\u26A1", grade: "GOLD", gradeColor: "#d0bcff", gradeBg: "rgba(208,188,255,.15)", title: "Point Powerhouse", value: `${totalRecPts} pts`, sub: "150+ points through recitation. Your contributions truly shine.", variant: "violet" });
    if (myRank === 1) trophies.push({ icon: "\u{1F947}", grade: "LEGENDARY", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: "Class Champion", value: "Rank #1", sub: "Top of the entire class leaderboard. The undisputed champion.", variant: "gold" });
    else if (myRank <= 3) trophies.push({ icon: "\u{1F3C5}", grade: "EPIC", gradeColor: "#ffd700", gradeBg: "rgba(255,215,0,.15)", title: `Top ${myRank} Leaderboard`, value: `Rank #${myRank}`, sub: `Among the top 3 students in your class. Elite performance.`, variant: "gold" });
    else if (myRank <= 5) trophies.push({ icon: "\u2B50", grade: "RARE", gradeColor: "#ffb95f", gradeBg: "rgba(255,185,95,.15)", title: "Top 5 Scholar", value: `Rank #${myRank}`, sub: "Inside the top 5 in class rankings. A strong competitor.", variant: "silver" });
    const topRecSession = recitations.length ? Math.max(...recitations.map((r) => r.pts || 0)) : 0;
    return `
  <div class="showcase-header">
    <span class="showcase-crown">\u{1F451}</span>
    <div class="showcase-title-text">ACADEMIC SHOWCASE</div>
    <div class="showcase-sub" style="position:relative;z-index:1">${_esc(st.name)} \xB7 ${st.tier} \xB7 Level ${st.level}</div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">share</span>
    <h2>Your Highlight Card</h2>
  </div>
  <div class="share-card">
    <div class="share-card-inner">
      <div class="share-watermark">EduQuest \xB7 Academic Achievement Profile</div>
      <div class="share-student-row">
        <div style="width:96px;height:96px;border-radius:50%;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-size:32px;font-weight:900;background:${_cssColor(st.color) + "33"};color:${_cssColor(st.color)};border:3px solid ${_cssColor(st.color) + "55"};box-shadow:0 0 30px ${_cssColor(st.color) + "33"}">${st.profilePic ? `<img src="${_esc(st.profilePic)}" alt="${_esc(st.init)}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" onerror="this.remove()">` : _esc(st.init)}</div>
        <div>
          <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface)">${_esc(st.name)}</div>
          <div style="font-size:13px;color:var(--text-muted)">${st.tier} \xB7 Level ${st.level} \xB7 Rank #${myRank}</div>
        </div>
      </div>
      <div class="share-stats-grid">
        ${[
      { sv: `${attPct}%`, sl: "Attendance", c: "#4edea3" },
      { sv: attStreaks.longest, sl: "Best Streak", c: "#f97316" },
      { sv: sessCount, sl: "Recitations", c: "#d0bcff" },
      { sv: perfectMonths, sl: "Perfect Months", c: "#ffd700" },
      { sv: totalRecPts, sl: "Rec Points", c: "#4edea3" },
      { sv: topRecSession, sl: "Best Score", c: "#ffb95f" }
    ].map((s) => `<div class="share-stat"><div class="sv" style="color:${s.c}">${s.sv}</div><div class="sl">${s.sl}</div></div>`).join("")}
      </div>
      <div class="share-badges-row">
        ${attPct >= 90 ? `<span class="share-badge-chip" style="background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.3);color:#4edea3">\u{1F4C5} ${attPct}% Attendance</span>` : ""}
        ${attStreaks.longest >= 7 ? `<span class="share-badge-chip" style="background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.3);color:#ffb95f">\u{1F525} ${attStreaks.longest}-Day Streak</span>` : ""}
        ${perfectMonths > 0 ? `<span class="share-badge-chip" style="background:rgba(208,188,255,.15);border:1px solid rgba(208,188,255,.3);color:#d0bcff">\u{1F48E} Perfect Month</span>` : ""}
        ${myRank <= 3 ? `<span class="share-badge-chip" style="background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.3);color:#ffd700">\u{1F947} Top ${myRank}</span>` : ""}
        ${earnedTitles.length > 0 ? `<span class="share-badge-chip" style="background:rgba(236,72,153,.15);border:1px solid rgba(236,72,153,.3);color:#EC4899">\u{1F396}\uFE0F ${earnedTitles[0].name}</span>` : ""}
      </div>
    </div>
  </div>

  <div class="section-header" style="margin-top:24px">
    <span class="material-symbols-outlined">emoji_events</span>
    <h2>Trophy Room</h2>
    <span class="badge-pill bp-gold">${trophies.length} trophies</span>
  </div>
  ${trophies.length ? `
  <div class="trophy-grid">
    ${trophies.map((t) => `
    <div class="trophy-card ${t.variant || ""}">
      <div class="trophy-icon-row">
        <span class="trophy-icon">${t.icon}</span>
        <span class="trophy-grade" style="color:${t.gradeColor};background:${t.gradeBg};border:1px solid ${t.gradeColor}33">${t.grade}</span>
      </div>
      <div class="trophy-card-title">${t.title}</div>
      <div class="trophy-card-value" style="color:${t.gradeColor}">${t.value}</div>
      <div class="trophy-card-sub">${t.sub}</div>
    </div>`).join("")}
  </div>` : `
  <div style="text-align:center;padding:56px 20px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px;margin-bottom:24px">
    <div style="font-size:48px;margin-bottom:12px">\u{1F3C6}</div>
    <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:6px">No trophies yet</div>
    <div style="color:var(--text-muted);font-size:13px">Attend class, recite, and earn perfect months to fill your trophy room!</div>
  </div>`}

  ${earnedAchs.length ? `
  <div class="section-header" style="margin-top:24px">
    <span class="material-symbols-outlined">workspace_premium</span>
    <h2>Achievements Earned</h2>
    <span class="badge-pill bp-primary">${earnedAchs.length} unlocked</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:28px">
    ${earnedAchs.map((a) => `
    <div class="glass-card" style="padding:16px;text-align:center;border-color:rgba(255,185,95,.25)">
      <div style="font-size:32px;margin-bottom:8px">${a.icon || "\u{1F3C6}"}</div>
      <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);margin-bottom:4px">${_esc(a.name)}</div>
      <div style="font-size:11px;color:var(--text-muted)">${_esc(a.description)}</div>
    </div>`).join("")}
  </div>` : ""}

  ${earnedTitles.length ? `
  <div class="section-header">
    <span class="material-symbols-outlined">military_tech</span>
    <h2>Titles Earned</h2>
    <span class="badge-pill bp-gold">${earnedTitles.length} titles</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px">
    ${earnedTitles.map((t) => `
    <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:12px;background:${_cssColor(t.bgColor, "rgba(255,215,0,.1)")};border:2px solid ${_cssColor(t.borderColor, "rgba(255,215,0,.4)")};font-family:var(--fh);font-size:14px;font-weight:800;color:${_cssColor(t.textColor, "#ffd700")}">
      ${t.icon || "\u{1F396}\uFE0F"} ${_esc(t.name)}
    </div>`).join("")}
  </div>` : ""}
  `;
  }
  var renderStudentProgress = function() {
    const st = currentUser;
    if (!st) {
      document.getElementById("s-attendance").innerHTML = '<div class="page" style="padding:40px;text-align:center;color:var(--text-muted)">Not logged in</div>';
      return;
    }
    const attendanceSess = progGetAttendanceForStudent(st.id);
    const recitations = progGetRecitationsForStudent(st.id);
    const presentCount = attendanceSess.filter((a) => a.status === "present").length;
    const absentCount = attendanceSess.filter((a) => a.status === "absent").length;
    const totalSess = attendanceSess.length;
    const attPct = totalSess > 0 ? Math.round(presentCount / totalSess * 100) : 0;
    const attStreaks = progAttStreak(attendanceSess);
    const recStreaks = progRecStreak(recitations);
    const perfectMonths = progPerfectMonths(attendanceSess);
    const recStats = typeof eqlComputeRecitation === "function" ? eqlComputeRecitation(st.id) : { totalPts: 0, sessionCount: recitations.length, streak: 0, wins: 0 };
    document.getElementById("s-attendance").innerHTML = `
  <div class="prog-hero">
    <div class="prog-hero-grid">
      <div>
        <div class="prog-hero-label">\u{1F4CA} Academic Progress</div>
        <div class="prog-hero-name">${_esc(st.name)}</div>
        <div class="prog-hero-sub">${_esc(st.tier)} \xB7 Level ${st.level} \xB7 <span style="color:var(--primary)">Your Complete Record</span></div>
        <div class="prog-stat-strip">
          <div class="prog-stat-chip"><span class="v" style="color:#4edea3">${attPct}%</span><span class="l">Attendance</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#f97316">${attStreaks.current}</span><span class="l">Current Streak</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#d0bcff">${recStats.sessionCount || recitations.length}</span><span class="l">Recitations</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#ffd700">${perfectMonths}</span><span class="l">Perfect Months</span></div>
        </div>
      </div>
      <div class="prog-hero-avatar" style="background:${_cssColor(st.color) + "22"};color:${_cssColor(st.color)};border-color:${_cssColor(st.color) + "44"};box-shadow:0 0 40px ${_cssColor(st.color) + "44"}">${_esc(st.init)}</div>
    </div>
  </div>

  <div class="prog-tabs">
    <button class="prog-tab ${progActiveTab === "streaks" ? "active" : ""}" onclick="progSwitchTab('streaks')"><span class="material-symbols-outlined">local_fire_department</span>Streaks &amp; Stats</button>
    <button class="prog-tab ${progActiveTab === "calendar" ? "active" : ""}" onclick="progSwitchTab('calendar')"><span class="material-symbols-outlined">calendar_month</span>Attendance Calendar</button>
    <button class="prog-tab ${progActiveTab === "recitation" ? "active" : ""}" onclick="progSwitchTab('recitation')"><span class="material-symbols-outlined">mic</span>Recitation History</button>
    <button class="prog-tab ${progActiveTab === "milestones" ? "active" : ""}" onclick="progSwitchTab('milestones')"><span class="material-symbols-outlined">emoji_events</span>Milestones</button>
    <button class="prog-tab ${progActiveTab === "showcase" ? "active" : ""}" onclick="progSwitchTab('showcase')"><span class="material-symbols-outlined">workspace_premium</span>Academic Showcase</button>
  </div>

  <div class="prog-panel ${progActiveTab === "streaks" ? "active" : ""}" id="prog-panel-streaks">
    ${progRenderStreaks(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, absentCount, attPct)}
  </div>
  <div class="prog-panel ${progActiveTab === "calendar" ? "active" : ""}" id="prog-panel-calendar">
    ${progRenderCalendarPanel(st)}
  </div>
  <div class="prog-panel ${progActiveTab === "recitation" ? "active" : ""}" id="prog-panel-recitation">
    ${progRenderRecitationPanel(st, recitations, recStats, recStreaks)}
  </div>
  <div class="prog-panel ${progActiveTab === "milestones" ? "active" : ""}" id="prog-panel-milestones">
    ${progRenderMilestones(st, presentCount, attStreaks, recStats, perfectMonths)}
  </div>
  <div class="prog-panel ${progActiveTab === "showcase" ? "active" : ""}" id="prog-panel-showcase">
    ${progRenderShowcase(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, attPct)}
  </div>
  `;
  };
  var progSwitchTab = function(tab) {
    progActiveTab = tab;
    window.renderStudentProgress();
  };
  var progCalNav = function(dir) {
    progCalMonth += dir;
    if (progCalMonth < 0) {
      progCalMonth = 11;
      progCalYear--;
    } else if (progCalMonth > 11) {
      progCalMonth = 0;
      progCalYear++;
    }
    const panel = document.getElementById("prog-panel-calendar");
    if (panel) panel.innerHTML = progRenderCalendarPanel(currentUser);
  };
  var progShowCalDay = function(day, year, month) {
    const calData = progBuildCalendar(currentUser.id, year, month);
    const d = calData[day];
    if (!d) return;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dateStr = `${months[month]} ${day}, ${year}`;
    let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <div style="font-size:28px">${d.status === "present" ? "\u2705" : d.status === "absent" ? "\u274C" : "\u{1F4CB}"}</div>
    <div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface)">${dateStr}</div>
      <div style="font-size:12px;color:${d.status === "present" ? "#4edea3" : d.status === "absent" ? "#ffb4ab" : "var(--text-muted)"};font-weight:700;margin-top:2px">
        ${d.status === "present" ? "Present" : d.status === "absent" ? "Absent" : "No attendance recorded"}
      </div>
    </div>
  </div>`;
    if (d.recitations.length) {
      html += `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">\u{1F3A4} Recitations (${d.recitations.length})</div>`;
      d.recitations.forEach((r) => {
        html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.15);border-radius:8px;margin-bottom:6px;font-size:12px">
        <span style="color:var(--on-surface)">${_esc(r.note || "Recitation")}</span>
        <span style="color:#4edea3;font-weight:800">+${r.pts} pts</span>
      </div>`;
      });
    }
    if (d.quizzes.length) {
      html += `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-top:10px;margin-bottom:8px">\u{1F4DD} Quests Completed (${d.quizzes.length})</div>`;
      d.quizzes.forEach((q) => {
        html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,185,95,.06);border:1px solid rgba(255,185,95,.15);border-radius:8px;margin-bottom:6px;font-size:12px">
        <span style="color:var(--on-surface)">${(q.what || "").replace("Quest: ", "")}</span>
        <span style="color:#ffb95f;font-weight:800">+${q.pts} XP</span>
      </div>`;
      });
    }
    if (!d.recitations.length && !d.quizzes.length && !d.status) {
      html += `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:8px">No activities recorded for this day.</div>`;
    }
    const detail = document.getElementById("cal-day-detail");
    if (detail) {
      detail.innerHTML = html;
      detail.classList.add("open");
    }
  };
  console.log("[EduQuest] recitation/progress.js loaded \u2014 renderStudentProgress, progSwitchTab, progCalNav, progShowCalDay registered.");

  // build/test-helpers/progress-combined-entry.js
  window.AppStore = AppStore;
  Object.keys(progress_exports).forEach((k) => {
    window[k] = progress_exports[k];
  });
})();
