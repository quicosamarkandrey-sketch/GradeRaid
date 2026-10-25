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

  // src/modules/attendance/attendance-service.js
  var AttendanceService = (function() {
    "use strict";
    function _upsertLogIntoDraft(draft, log) {
      if (!log) return;
      if (!Array.isArray(draft.attendanceLogs)) draft.attendanceLogs = [];
      const idx = draft.attendanceLogs.findIndex(
        (l) => log.id && l.id === log.id || l.studentId === log.studentId && l.classId === log.classId && l.logDate === log.logDate
      );
      const row = {
        id: log.id,
        studentId: log.student_id || log.studentId,
        classId: log.class_id || log.classId,
        logDate: log.log_date || log.logDate,
        status: log.status,
        scannedAt: log.scanned_at || log.scannedAt,
        entryMethod: log.entry_method || log.entryMethod,
        rfidTag: log.rfid_tag ?? log.rfidTag ?? null,
        recordedBy: log.recorded_by ?? log.recordedBy ?? null,
        notes: log.notes ?? null
      };
      if (idx >= 0) draft.attendanceLogs[idx] = row;
      else draft.attendanceLogs.unshift(row);
    }
    async function assignCard(studentId, rfidTag) {
      const tagId = String(rfidTag || "").trim();
      if (!studentId || !tagId) {
        return { ok: false, error: "Student and card tag are both required." };
      }
      const { data, error } = await DBService2.rpc("assign_rfid_card", {
        p_student_id: studentId,
        p_tag_id: tagId
      });
      if (error) {
        console.error("[AttendanceService] assignCard failed:", error);
        return { ok: false, error: error.message || "Could not assign card." };
      }
      AppStore.updateState((draft) => {
        if (!Array.isArray(draft.rfidCards)) draft.rfidCards = [];
        draft.rfidCards.forEach((c) => {
          if ((c.studentId === studentId || c.tagId === tagId) && c.isActive && c.id !== data.id) {
            c.isActive = false;
            c.revokedAt = (/* @__PURE__ */ new Date()).toISOString();
          }
        });
        const idx = draft.rfidCards.findIndex((c) => c.id === data.id);
        const row = {
          id: data.id,
          tagId: data.tag_id,
          studentId: data.student_id,
          isActive: data.is_active,
          assignedAt: data.assigned_at,
          revokedAt: data.revoked_at
        };
        if (idx >= 0) draft.rfidCards[idx] = row;
        else draft.rfidCards.unshift(row);
      }, { type: "attendance:card-assigned", payload: { studentId, tagId } });
      return { ok: true, card: data };
    }
    async function assignStudentToClass(studentId, classId) {
      if (!studentId || !classId) return { ok: false, error: "Student and class are both required." };
      const { error } = await DBService2.rpc("set_student_class", {
        p_student_id: studentId,
        p_class_id: classId
      });
      if (error) {
        console.error("[AttendanceService] assignStudentToClass failed:", error);
        return { ok: false, error: error.message || "Could not update class assignment." };
      }
      AppStore.updateState((draft) => {
        const s = (draft.students || []).find((st) => st.id === studentId);
        if (s) s.classId = classId;
      }, { type: "attendance:student-class-changed", payload: { studentId, classId } });
      return { ok: true };
    }
    async function upsertSchedule(classId, times, dayOfWeek, dayOff) {
      const { openTime, startTime, lateCutoff, closeTime } = times || {};
      const dow = dayOfWeek === void 0 || dayOfWeek === null ? 0 : dayOfWeek;
      const isDayOff = !!dayOff;
      if (!classId || !openTime || !startTime || !lateCutoff || !closeTime) {
        return { ok: false, error: "classId, openTime, startTime, lateCutoff, and closeTime are all required." };
      }
      const { data, error } = await DBService2.rpc("upsert_attendance_schedule", {
        p_class_id: classId,
        p_open_time: openTime,
        p_start_time: startTime,
        p_late_cutoff: lateCutoff,
        p_close_time: closeTime,
        p_day_of_week: dow,
        p_day_off: isDayOff
      });
      if (error) {
        console.error("[AttendanceService] upsertSchedule failed:", error);
        return { ok: false, error: error.message || "Could not save schedule." };
      }
      AppStore.updateState((draft) => {
        if (!Array.isArray(draft.attendanceSchedules)) draft.attendanceSchedules = [];
        const idx = draft.attendanceSchedules.findIndex((s) => s.classId === classId && (s.dayOfWeek || 0) === dow);
        const row = {
          id: data.id,
          classId: data.class_id,
          dayOfWeek: data.day_of_week ?? dow,
          dayOff: !!data.day_off,
          openTime: data.open_time,
          startTime: data.start_time,
          lateCutoff: data.late_cutoff,
          closeTime: data.close_time,
          active: data.active
        };
        if (idx >= 0) draft.attendanceSchedules[idx] = row;
        else draft.attendanceSchedules.push(row);
      }, { type: "attendance:schedule-updated", payload: { classId, dayOfWeek: dow, dayOff: isDayOff } });
      return { ok: true, schedule: data };
    }
    async function setDayOff(classId, dayOfWeek) {
      if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
        return { ok: false, error: "dayOfWeek must be between 1 (Monday) and 7 (Sunday)." };
      }
      return upsertSchedule(classId, { openTime: "00:00", startTime: "00:00", lateCutoff: "00:00", closeTime: "00:00" }, dayOfWeek, true);
    }
    async function clearScheduleOverride(classId, dayOfWeek) {
      if (!classId) return { ok: false, error: "classId is required." };
      if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
        return { ok: false, error: "dayOfWeek must be between 1 (Monday) and 7 (Sunday)." };
      }
      const { data, error } = await DBService2.rpc("clear_attendance_schedule_override", {
        p_class_id: classId,
        p_day_of_week: dayOfWeek
      });
      if (error) {
        console.error("[AttendanceService] clearScheduleOverride failed:", error);
        return { ok: false, error: error.message || "Could not clear that day's override." };
      }
      AppStore.updateState((draft) => {
        draft.attendanceSchedules = (draft.attendanceSchedules || []).filter((s) => !(s.classId === classId && (s.dayOfWeek || 0) === dayOfWeek));
      }, { type: "attendance:schedule-override-cleared", payload: { classId, dayOfWeek } });
      return { ok: true, removed: !!data };
    }
    function getEffectiveSchedule(classId, opts) {
      opts = opts || {};
      if (!classId) return null;
      const all = AppStore.getSlice((s) => s.attendanceSchedules) || [];
      const mine = all.filter((s) => s.classId === classId && s.active !== false);
      if (!mine.length) return null;
      const d = opts.date || /* @__PURE__ */ new Date();
      const manilaDowLabel = d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short" });
      const isoDow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[manilaDowLabel] || 1;
      const override = mine.find((s) => (s.dayOfWeek || 0) === isoDow);
      if (override) return override;
      return mine.find((s) => (s.dayOfWeek || 0) === 0) || null;
    }
    async function processScan(rfidTag, classId) {
      const tagId = String(rfidTag || "").trim();
      if (!tagId) return { ok: false, error: "empty_scan", message: "No card data received." };
      if (!classId) return { ok: false, error: "no_class", message: "No class selected for this scanner." };
      const { data, error } = await DBService2.rpc("process_attendance_scan", {
        p_tag_id: tagId,
        p_class_id: classId
      });
      if (error) {
        console.error("[AttendanceService] processScan RPC failed:", error);
        return { ok: false, error: "network", message: error.message || "Scan failed \u2014 try again." };
      }
      if (!data || data.ok === false) {
        return { ok: false, error: data && data.error || "unknown", message: data && data.message || "Scan rejected." };
      }
      AppStore.updateState((draft) => {
        _upsertLogIntoDraft(draft, data.log);
        const student2 = (draft.students || []).find((s) => s.id === data.student_id);
        if (student2) {
          recalcStudentStats(student2, { attendanceLogs: draft.attendanceLogs });
          syncStudentDerivedStatsToServer(student2.id, student2.attendance, student2.quizAvg);
        }
      }, { type: "attendance:scan-recorded", payload: { studentId: data.student_id, status: data.status, alreadyRecorded: !!data.already_recorded } });
      const student = AppStore.getStudent(data.student_id);
      return {
        ok: true,
        alreadyRecorded: !!data.already_recorded,
        studentId: data.student_id,
        status: data.status,
        studentName: student ? student.name || student.displayName : data.student_id
      };
    }
    async function overrideAttendance(studentId, classId, status, opts) {
      opts = opts || {};
      if (!studentId || !classId || !status) {
        return { ok: false, error: "studentId, classId, and status are all required." };
      }
      const recordedBy = typeof currentUser !== "undefined" && currentUser ? currentUser.id : null;
      const rpcParams = {
        p_student_id: studentId,
        p_class_id: classId,
        p_status: status,
        p_recorded_by: recordedBy,
        p_notes: opts.notes || null
      };
      if (opts.logDate) rpcParams.p_log_date = opts.logDate;
      const { data, error } = await DBService2.rpc("override_attendance", rpcParams);
      if (error) {
        console.error("[AttendanceService] overrideAttendance failed:", error);
        return { ok: false, error: error.message || "Could not save override." };
      }
      if (data && data.ok === false) {
        return { ok: false, error: data.message || "Override rejected." };
      }
      AppStore.updateState((draft) => {
        if (data.removed) {
          const logDate = opts.logDate || isoDate();
          draft.attendanceLogs = (draft.attendanceLogs || []).filter(
            (l) => !(l.studentId === studentId && l.classId === classId && l.logDate === logDate)
          );
        } else {
          _upsertLogIntoDraft(draft, data.log);
        }
        const student = (draft.students || []).find((s) => s.id === studentId);
        if (student) {
          recalcStudentStats(student, { attendanceLogs: draft.attendanceLogs });
          syncStudentDerivedStatsToServer(student.id, student.attendance, student.quizAvg);
        }
      }, { type: "attendance:override", payload: { studentId, classId, status } });
      return data.removed ? { ok: true, removed: true } : { ok: true, log: data.log };
    }
    async function closeAttendanceSession(classId, logDate) {
      if (!classId) return { ok: false, error: "classId is required." };
      const day = logDate || isoDate();
      const { data, error } = await DBService2.rpc("close_attendance_session", {
        p_class_id: classId,
        p_log_date: day
      });
      if (error) {
        console.error("[AttendanceService] closeAttendanceSession failed:", error);
        return { ok: false, error: error.message || "Could not close session." };
      }
      AppStore.updateState((draft) => {
        if (!Array.isArray(draft.attendanceLogs)) draft.attendanceLogs = [];
        const already = new Set(
          draft.attendanceLogs.filter((l) => l.classId === classId && l.logDate === day).map((l) => l.studentId)
        );
        const sweptStudentIds = [];
        (draft.students || []).filter((s) => (s.classId || "default-class") === classId && !already.has(s.id)).forEach((s) => {
          draft.attendanceLogs.unshift({
            id: null,
            studentId: s.id,
            classId,
            logDate: day,
            status: "Absent",
            scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
            entryMethod: "Manual",
            rfidTag: null,
            recordedBy: null,
            notes: null
          });
          sweptStudentIds.push(s.id);
        });
        sweptStudentIds.forEach((id) => {
          const student = (draft.students || []).find((s) => s.id === id);
          if (student) {
            recalcStudentStats(student, { attendanceLogs: draft.attendanceLogs });
            syncStudentDerivedStatsToServer(student.id, student.attendance, student.quizAvg);
          }
        });
      }, { type: "attendance:session-closed", payload: { classId, logDate: day, absencesRecorded: data.absences_recorded } });
      return { ok: true, absencesRecorded: data.absences_recorded };
    }
    return {
      assignCard,
      assignStudentToClass,
      upsertSchedule,
      clearScheduleOverride,
      getEffectiveSchedule,
      processScan,
      overrideAttendance,
      closeAttendanceSession
    };
  })();
  console.log("[EduQuest] attendance/attendance-service.js loaded \u2014 AttendanceService registered.");

  // src/modules/attendance/att_scanner_rfid.js
  var att_scanner_rfid_exports = {};
  __export(att_scanner_rfid_exports, {
    _rfidAssignTargetStudentId: () => _rfidAssignTargetStudentId,
    _rfidClassOptionLabel: () => _rfidClassOptionLabel,
    _rfidClassRank: () => _rfidClassRank,
    _rfidClockInterval: () => _rfidClockInterval,
    _rfidCloseSession: () => _rfidCloseSession,
    _rfidFinalizeScan: () => _rfidFinalizeScan,
    _rfidFocusInterval: () => _rfidFocusInterval,
    _rfidFormatCountdown: () => _rfidFormatCountdown,
    _rfidHandleAssignScan: () => _rfidHandleAssignScan,
    _rfidHandleAttendanceScan: () => _rfidHandleAttendanceScan,
    _rfidInactivityTimer: () => _rfidInactivityTimer,
    _rfidKioskMode: () => _rfidKioskMode,
    _rfidLevelProgress: () => _rfidLevelProgress,
    _rfidNextScheduleMilestone: () => _rfidNextScheduleMilestone,
    _rfidNormalizeTagId: () => _rfidNormalizeTagId,
    _rfidOnClassChange: () => _rfidOnClassChange,
    _rfidOpenAssignPicker: () => _rfidOpenAssignPicker,
    _rfidOpenSettings: () => _rfidOpenSettings,
    _rfidProfileCardHtml: () => _rfidProfileCardHtml,
    _rfidRefreshClassSelectCounts: () => _rfidRefreshClassSelectCounts,
    _rfidRefreshWebNfcButton: () => _rfidRefreshWebNfcButton,
    _rfidRenderActivity: () => _rfidRenderActivity,
    _rfidRenderScheduleForm: () => _rfidRenderScheduleForm,
    _rfidRenderSpotlight: () => _rfidRenderSpotlight,
    _rfidSaveSchedule: () => _rfidSaveSchedule,
    _rfidScanBuffer: () => _rfidScanBuffer,
    _rfidScanMode: () => _rfidScanMode,
    _rfidScannerMounted: () => _rfidScannerMounted,
    _rfidScheduleFor: () => _rfidScheduleFor,
    _rfidScheduleTimerInterval: () => _rfidScheduleTimerInterval,
    _rfidSelectedClassId: () => _rfidSelectedClassId,
    _rfidSetMode: () => _rfidSetMode,
    _rfidSpotlightIdleHtml: () => _rfidSpotlightIdleHtml,
    _rfidStartCapture: () => _rfidStartCapture,
    _rfidStartClock: () => _rfidStartClock,
    _rfidStartScheduleTimer: () => _rfidStartScheduleTimer,
    _rfidStartWebNfcCapture: () => _rfidStartWebNfcCapture,
    _rfidStopWebNfcCapture: () => _rfidStopWebNfcCapture,
    _rfidTickClock: () => _rfidTickClock,
    _rfidTickScheduleTimer: () => _rfidTickScheduleTimer,
    _rfidTimeStrToDate: () => _rfidTimeStrToDate,
    _rfidTodayISO: () => _rfidTodayISO,
    _rfidToggleKioskMode: () => _rfidToggleKioskMode,
    _rfidToggleWebNfc: () => _rfidToggleWebNfc,
    _rfidUpdateStatusEyebrow: () => _rfidUpdateStatusEyebrow,
    _rfidWebNfcAbortController: () => _rfidWebNfcAbortController,
    _rfidWebNfcActive: () => _rfidWebNfcActive,
    _rfidWebNfcSupported: () => _rfidWebNfcSupported,
    _rfidWelcomeMessage: () => _rfidWelcomeMessage,
    renderRfidScanner: () => renderRfidScanner,
    unmountRfidScanner: () => unmountRfidScanner
  });
  var _rfidFocusInterval = null;
  var _rfidScanBuffer = "";
  var _rfidInactivityTimer = null;
  var _rfidScannerMounted = false;
  var _rfidScanMode = "attendance";
  var _rfidAssignTargetStudentId = null;
  var _rfidSelectedClassId = "default-class";
  var _rfidClockInterval = null;
  var _rfidScheduleTimerInterval = null;
  var _rfidWebNfcActive = false;
  var _rfidWebNfcAbortController = null;
  var _rfidKioskMode = false;
  var renderRfidScanner = function() {
    _rfidScannerMounted = true;
    _rfidSelectedClassId = _rfidSelectedClassId || "default-class";
    _rfidKioskMode = false;
    document.body.classList.remove("rfid-kiosk-mode");
    const state = typeof AppStore !== "undefined" ? AppStore.getState() : {};
    const classIds = window.getActiveClassIds ? window.getActiveClassIds(state) : Array.from(new Set((state.students || []).map((s) => s.classId || "default-class"))).sort();
    if (!classIds.includes(_rfidSelectedClassId)) _rfidSelectedClassId = classIds[0] || "default-class";
    document.getElementById("a-scanner").innerHTML = `
    <div class="kiosk-page">
      <input id="rfid-capture-input" autocomplete="off" inputmode="none"
             style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" />

      <div class="kiosk-status-eyebrow" id="kiosk-status-eyebrow"></div>
      <div class="kiosk-clock-corner" id="kiosk-clock-corner"></div>

      <div class="kiosk-topstrip">
        <select id="rfid-class-select" class="kiosk-class-select" onchange="_rfidOnClassChange(this.value)">
          ${classIds.map((c) => `<option value="${_esc(c)}" ${c === _rfidSelectedClassId ? "selected" : ""}>${_esc(_rfidClassOptionLabel(c, state))}</option>`).join("")}
        </select>
        <button class="kiosk-fullscreen-btn${_rfidKioskMode ? " active" : ""}" id="rfid-fullscreen-btn"
          onclick="_rfidToggleKioskMode()"
          title="${_rfidKioskMode ? "Exit fullscreen" : "Fill the screen for scanning/kiosk display"}">
          ${_rfidKioskMode ? "\u2922 Exit" : "\u26F6 Fullscreen"}
        </button>
        <button class="kiosk-icon-btn" title="Settings \u2014 schedule, assign card, close session" onclick="_rfidOpenSettings()">\u2699\uFE0F</button>
        ${_rfidWebNfcSupported() ? `
        <button class="kiosk-icon-btn${_rfidWebNfcActive ? " active" : ""}" id="rfid-webnfc-btn"
          title="${_rfidWebNfcActive ? "Stop using this phone as an NFC reader" : "Use this phone as an NFC reader \u2014 tap to arm, then hold cards to the back of the phone"}"
          onclick="_rfidToggleWebNfc()">
          ${_rfidWebNfcActive ? "\u{1F4F1} NFC On" : "\u{1F4F1} Use Phone as Reader"}
        </button>` : ""}
        <!-- BUGFIX (report \xA74): true fullscreen hides the whole app shell
             (topbar + sidebar) so students scanning cards don't see admin
             nav, but nothing was left in its place to get back out \u2014 the
             only way out was the browser Back button. This calls the same
             navTo() every other nav link uses, which already tears down
             kiosk mode via unmountRfidScanner() in nav.js. Only shown while
             actually fullscreen \u2014 the sidebar already covers this otherwise. -->
        ${_rfidKioskMode ? `<button class="kiosk-icon-btn" id="rfid-exit-kiosk-btn" title="Exit kiosk \u2014 back to admin dashboard" onclick="navTo('a-dashboard')">\u23FB</button>` : ""}
      </div>

      <div class="kiosk-columns">
        <div class="kiosk-spotlight" id="kiosk-spotlight"></div>

        <div class="kiosk-activity">
          <div class="kiosk-activity-header">Recent Activity</div>
          <div class="kiosk-schedule-timer" id="kiosk-schedule-timer"></div>
          <div class="kiosk-roster-stats" id="kiosk-roster-stats"></div>
          <div class="kiosk-activity-summary" id="kiosk-activity-summary"></div>
          <div class="kiosk-activity-list" id="kiosk-activity-list"></div>
        </div>
      </div>
    </div>`;
    _rfidRenderSpotlight("idle");
    _rfidRenderActivity();
    _rfidUpdateStatusEyebrow();
    _rfidStartCapture();
    _rfidStartClock();
    _rfidStartScheduleTimer();
    AppStore.subscribe("rfid-scanner", function(state2, event) {
      if (!_rfidScannerMounted) return;
      if (!event || event.type === "state:updated" || event.type.indexOf("attendance:") === 0 || event.type === "state:remote-sync") {
        _rfidRenderActivity();
        _rfidRefreshClassSelectCounts();
        _rfidUpdateStatusEyebrow();
      }
    });
  };
  function _rfidUpdateStatusEyebrow() {
    const el = document.getElementById("kiosk-status-eyebrow");
    if (!el) return;
    const state = typeof AppStore !== "undefined" ? AppStore.getState() : {};
    const label = window.getClassLabel ? window.getClassLabel(_rfidSelectedClassId, state) : _rfidSelectedClassId;
    const info = _rfidNextScheduleMilestone(_rfidSelectedClassId);
    const statusText = info.tone === "closed" ? "Closed" : info.tone === "late" ? "Late window" : "Scanning";
    el.innerHTML = `<span class="dot"></span><span>${_esc(label)} \xB7 ${_esc(statusText)}</span>`;
  }
  function _rfidClassOptionLabel(classId, state) {
    const label = window.getClassLabel ? window.getClassLabel(classId, state) : classId;
    const enrolled = (state.students || []).filter((s) => (s.classId || "default-class") === classId).length;
    const today = _rfidTodayISO();
    const scannedToday = (state.attendanceLogs || []).filter((l) => l.classId === classId && l.logDate === today).length;
    return `${label} (${scannedToday}/${enrolled})`;
  }
  function _rfidRefreshClassSelectCounts() {
    const select = document.getElementById("rfid-class-select");
    if (!select) return;
    const state = AppStore.getState();
    Array.from(select.options).forEach((opt) => {
      opt.textContent = _rfidClassOptionLabel(opt.value, state);
    });
  }
  var unmountRfidScanner = function() {
    _rfidScannerMounted = false;
    if (_rfidFocusInterval) {
      clearInterval(_rfidFocusInterval);
      _rfidFocusInterval = null;
    }
    if (_rfidInactivityTimer) {
      clearTimeout(_rfidInactivityTimer);
      _rfidInactivityTimer = null;
    }
    if (_rfidClockInterval) {
      clearInterval(_rfidClockInterval);
      _rfidClockInterval = null;
    }
    if (_rfidScheduleTimerInterval) {
      clearInterval(_rfidScheduleTimerInterval);
      _rfidScheduleTimerInterval = null;
    }
    if (_rfidWebNfcAbortController) {
      _rfidWebNfcAbortController.abort();
      _rfidWebNfcAbortController = null;
    }
    _rfidWebNfcActive = false;
    clearTimeout(window._rfidSpotlightResetTimer);
    _rfidKioskMode = false;
    document.body.classList.remove("rfid-kiosk-mode");
    AppStore.unsubscribe("rfid-scanner");
  };
  var _rfidToggleKioskMode = function() {
    _rfidKioskMode = !_rfidKioskMode;
    document.body.classList.toggle("rfid-kiosk-mode", _rfidKioskMode);
    const btn = document.getElementById("rfid-fullscreen-btn");
    if (btn) {
      btn.classList.toggle("active", _rfidKioskMode);
      btn.title = _rfidKioskMode ? "Exit fullscreen" : "Fill the screen for scanning/kiosk display";
      btn.textContent = _rfidKioskMode ? "\u2922 Exit" : "\u26F6 Fullscreen";
    }
    const topstrip = document.querySelector(".kiosk-topstrip");
    let exitBtn = document.getElementById("rfid-exit-kiosk-btn");
    if (_rfidKioskMode && !exitBtn && topstrip) {
      exitBtn = document.createElement("button");
      exitBtn.id = "rfid-exit-kiosk-btn";
      exitBtn.className = "kiosk-icon-btn";
      exitBtn.title = "Exit kiosk \u2014 back to admin dashboard";
      exitBtn.textContent = "\u23FB";
      exitBtn.onclick = function() {
        navTo("a-dashboard");
      };
      topstrip.appendChild(exitBtn);
    } else if (!_rfidKioskMode && exitBtn) {
      exitBtn.remove();
    }
  };
  function _rfidTickClock() {
    const el = document.getElementById("kiosk-clock-corner");
    if (!el) return;
    const now = /* @__PURE__ */ new Date();
    const time = now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
    const blinkTime = _esc(time).replace(":", '<span class="kiosk-clock-blink">:</span>');
    el.innerHTML = `<div class="kiosk-clock-time">${blinkTime}</div><div class="kiosk-clock-date">${_esc(date)}</div>`;
  }
  function _rfidStartClock() {
    if (_rfidClockInterval) clearInterval(_rfidClockInterval);
    _rfidTickClock();
    _rfidClockInterval = setInterval(_rfidTickClock, 1e3 * 15);
  }
  function _rfidScheduleFor(classId) {
    const sched = typeof AttendanceService !== "undefined" && AttendanceService.getEffectiveSchedule ? AttendanceService.getEffectiveSchedule(classId) : AppStore.getSlice((s) => (s.attendanceSchedules || []).find((x) => x.classId === classId && (x.dayOfWeek || 0) === 0));
    return sched || { openTime: "07:00", startTime: "07:30", lateCutoff: "07:45", closeTime: "08:30" };
  }
  function _rfidTimeStrToDate(hhmm, base) {
    const parts = (hhmm || "00:00").split(":").map(Number);
    const d = new Date(base);
    d.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
    return d;
  }
  function _rfidNextScheduleMilestone(classId) {
    const sched = _rfidScheduleFor(classId);
    const now = /* @__PURE__ */ new Date();
    const open = _rfidTimeStrToDate(sched.openTime, now);
    const late = _rfidTimeStrToDate(sched.lateCutoff, now);
    const close = _rfidTimeStrToDate(sched.closeTime, now);
    if (now < open) return { label: "Opens in", target: open, tone: "open" };
    if (now < late) return { label: "Late in", target: late, tone: "late" };
    if (now < close) return { label: "Closes in", target: close, tone: "close" };
    return { label: "Session closed", target: null, tone: "closed" };
  }
  function _rfidFormatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor(totalSec % 3600 / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  function _rfidTickScheduleTimer() {
    _rfidUpdateStatusEyebrow();
    const el = document.getElementById("kiosk-schedule-timer");
    if (!el) return;
    const info = _rfidNextScheduleMilestone(_rfidSelectedClassId);
    if (!info.target) {
      el.innerHTML = `<div class="kiosk-timer-chip kiosk-timer-closed"><span class="kiosk-timer-label">\u{1F512} Session closed</span></div>`;
      return;
    }
    const remaining = _rfidFormatCountdown(info.target - /* @__PURE__ */ new Date());
    const icons = { open: "\u{1F6AA}", late: "\u23F0", close: "\u{1F512}" };
    el.innerHTML = `
    <div class="kiosk-timer-chip kiosk-timer-${info.tone}">
      <span class="kiosk-timer-icon">${icons[info.tone] || "\u23F1"}</span>
      <span class="kiosk-timer-label">${_esc(info.label)}</span>
      <span class="kiosk-timer-value">${_esc(remaining)}</span>
    </div>`;
  }
  function _rfidStartScheduleTimer() {
    if (_rfidScheduleTimerInterval) clearInterval(_rfidScheduleTimerInterval);
    _rfidTickScheduleTimer();
    _rfidScheduleTimerInterval = setInterval(_rfidTickScheduleTimer, 1e3);
  }
  function _rfidStartCapture() {
    const input = document.getElementById("rfid-capture-input");
    if (!input) return;
    input.value = "";
    _rfidScanBuffer = "";
    input.focus();
    if (_rfidFocusInterval) clearInterval(_rfidFocusInterval);
    _rfidFocusInterval = setInterval(function() {
      if (!_rfidScannerMounted) return;
      const active = document.activeElement;
      const isRealInput = active && active !== input && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA");
      if (!isRealInput && document.getElementById("rfid-capture-input")) {
        document.getElementById("rfid-capture-input").focus();
      }
    }, 600);
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        _rfidFinalizeScan(input.value);
        return;
      }
      if (_rfidInactivityTimer) clearTimeout(_rfidInactivityTimer);
      _rfidInactivityTimer = setTimeout(function() {
        if (input.value) _rfidFinalizeScan(input.value);
      }, 120);
    });
  }
  function _rfidWebNfcSupported() {
    return typeof window !== "undefined" && "NDEFReader" in window;
  }
  var _rfidToggleWebNfc = function() {
    if (_rfidWebNfcActive) {
      _rfidStopWebNfcCapture();
    } else {
      _rfidStartWebNfcCapture();
    }
  };
  async function _rfidStartWebNfcCapture() {
    if (!_rfidWebNfcSupported()) return;
    try {
      _rfidWebNfcAbortController = new AbortController();
      const ndef = new NDEFReader();
      await ndef.scan({ signal: _rfidWebNfcAbortController.signal });
      _rfidWebNfcActive = true;
      _rfidRefreshWebNfcButton();
      toast("\u{1F4F1} Phone NFC reader armed \u2014 hold cards to the back of the phone", "#4edea3");
      ndef.onreading = (event) => {
        if (!_rfidScannerMounted) return;
        const tagId = event.serialNumber;
        if (tagId) _rfidFinalizeScan(tagId);
      };
      ndef.onreadingerror = () => {
        toast("\u26A0\uFE0F Could not read that tag \u2014 try again", "#ffd166");
      };
    } catch (err) {
      _rfidWebNfcActive = false;
      _rfidWebNfcAbortController = null;
      _rfidRefreshWebNfcButton();
      toast("Could not start phone NFC: " + (err && err.message ? err.message : err), "#ffb4ab");
    }
  }
  function _rfidStopWebNfcCapture() {
    if (_rfidWebNfcAbortController) {
      _rfidWebNfcAbortController.abort();
      _rfidWebNfcAbortController = null;
    }
    _rfidWebNfcActive = false;
    _rfidRefreshWebNfcButton();
  }
  function _rfidRefreshWebNfcButton() {
    const btn = document.getElementById("rfid-webnfc-btn");
    if (!btn) return;
    btn.classList.toggle("active", _rfidWebNfcActive);
    btn.textContent = _rfidWebNfcActive ? "\u{1F4F1} NFC On" : "\u{1F4F1} Use Phone as Reader";
    btn.title = _rfidWebNfcActive ? "Stop using this phone as an NFC reader" : "Use this phone as an NFC reader \u2014 tap to arm, then hold cards to the back of the phone";
  }
  function _rfidNormalizeTagId(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^[0-9a-fA-F]{2}([:\-][0-9a-fA-F]{2})+$/.test(s)) {
      const hexBytes = s.split(/[:\-]/);
      const reversedHex = hexBytes.slice().reverse().join("");
      try {
        const asDecimal = BigInt("0x" + reversedHex).toString();
        return hexBytes.length === 4 ? asDecimal.padStart(10, "0") : asDecimal;
      } catch (e) {
        return s.replace(/[:\-]/g, "").toUpperCase();
      }
    }
    return s;
  }
  function _rfidFinalizeScan(rawValue) {
    const input = document.getElementById("rfid-capture-input");
    const tagId = _rfidNormalizeTagId(rawValue);
    if (input) input.value = "";
    if (_rfidInactivityTimer) {
      clearTimeout(_rfidInactivityTimer);
      _rfidInactivityTimer = null;
    }
    if (!tagId) return;
    if (_rfidScanMode === "assign") {
      _rfidHandleAssignScan(tagId);
    } else {
      _rfidHandleAttendanceScan(tagId);
    }
  }
  async function _rfidHandleAttendanceScan(tagId) {
    _rfidRenderSpotlight("loading", { text: "Checking card\u2026" });
    const result = await AttendanceService.processScan(tagId, _rfidSelectedClassId);
    if (!result.ok) {
      if (result.error === "closed") {
        _rfidRenderSpotlight("closed", { message: result.message });
        return;
      }
      const messages = {
        unknown_card: "Unknown card \u2014 not registered to any student.",
        no_schedule: "No schedule configured for this class.",
        not_open: "Attendance has not opened yet.",
        wrong_section: result.message || "This student is enrolled in a different section and cannot be scanned here."
      };
      _rfidRenderSpotlight("error", {
        message: messages[result.error] || result.message || "Scan failed.",
        rawTag: result.error === "unknown_card" ? tagId : null
      });
      return;
    }
    const student = AppStore.getStudent(result.studentId);
    _rfidRenderSpotlight("profile", {
      student,
      status: result.status,
      alreadyRecorded: result.alreadyRecorded,
      fallbackName: result.studentName
    });
    _rfidRenderActivity();
  }
  async function _rfidHandleAssignScan(tagId) {
    if (!_rfidAssignTargetStudentId) {
      _rfidRenderSpotlight("message", { icon: "\u26A0\uFE0F", text: "Pick a student in Settings before scanning.", color: "#ffd166" });
      return;
    }
    _rfidRenderSpotlight("loading", { text: "Assigning card\u2026" });
    const result = await AttendanceService.assignCard(_rfidAssignTargetStudentId, tagId);
    if (!result.ok) {
      _rfidRenderSpotlight("message", { icon: "\u274C", text: result.error || "Could not assign card.", color: "#ffb4ab", rawTag: tagId });
      return;
    }
    const student = AppStore.getStudent(_rfidAssignTargetStudentId);
    _rfidRenderSpotlight("message", { icon: "\u{1FAAA}", text: `Card assigned to ${student ? student.name : _rfidAssignTargetStudentId}.`, color: "#4edea3", rawTag: tagId });
  }
  function _rfidSpotlightIdleHtml() {
    if (_rfidScanMode === "assign") {
      const target = _rfidAssignTargetStudentId ? AppStore.getStudent(_rfidAssignTargetStudentId) : null;
      return `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">\u{1FAAA}</div>
        <div class="kiosk-spotlight-idle-text">Ready to assign a card</div>
        <div class="kiosk-spotlight-idle-sub">${target ? `Tap a card for ${_esc(target.name)}` : "Pick a student in Settings first"}</div>
      </div>`;
    }
    return `
    <div class="kiosk-spotlight-idle">
      <div class="kiosk-spotlight-idle-icon">\u{1F4F6}</div>
      <div class="kiosk-spotlight-idle-text">Waiting for a card\u2026</div>
      <div class="kiosk-spotlight-idle-sub">Class: ${_esc(_rfidSelectedClassId)}</div>
    </div>`;
  }
  function _rfidWelcomeMessage(name, status, streak, alreadyRecorded) {
    const firstName = _esc(String(name || "Student").trim().split(/\s+/)[0]);
    if (alreadyRecorded) return `You're already logged in for today, ${firstName}. See you in class!`;
    if (status === "Late") return `You're logged in, ${firstName} \u2014 try to beat the bell tomorrow!`;
    if (streak && streak.current >= 3) return `Welcome back, ${firstName}! That's a ${streak.current}-day streak \u2014 keep up the great work!`;
    if (status === "Early") return `Welcome back, ${firstName}! Great to see you here early!`;
    return `Welcome back, ${firstName}! Keep up the great work!`;
  }
  function _rfidLevelProgress(student) {
    if (!student) return null;
    const lvl = student.level || 0;
    const xp = student.xp || 0;
    const xpNext = (lvl + 1) * 1e3;
    const pct = Math.min(100, Math.round(xp / xpNext * 100));
    return { lvl, xp, xpNext, pct };
  }
  function _rfidClassRank(student) {
    if (!student) return null;
    const classmates = AppStore.getSlice((s) => (s.students || []).filter(
      (x) => (x.classId || "default-class") === (student.classId || "default-class")
    )) || [];
    if (classmates.length < 2) return null;
    const sorted = classmates.slice().sort((a, b) => (b.xp || 0) - (a.xp || 0));
    const idx = sorted.findIndex((s) => s.id === student.id);
    return idx === -1 ? null : { rank: idx + 1, of: sorted.length };
  }
  function _rfidProfileCardHtml(student, status, alreadyRecorded, fallbackName) {
    const icons = { "Early": "\u{1F305}", "On Time": "\u2705", "Late": "\u23F0" };
    const colors = { "Early": "#7fd8ff", "On Time": "#4edea3", "Late": "#ffd166" };
    const badgeColor = colors[status] || "#4edea3";
    const name = student ? student.name || student.displayName : fallbackName;
    const initials = student && student.init || String(name || "?").trim().slice(0, 2).toUpperCase();
    const avatarColor = _cssColor(student && student.color);
    const pct = student ? Math.round(Number(student.attendance) || 0) : null;
    const pctColor = pct === null ? "var(--text-muted)" : pct >= 90 ? "#4edea3" : pct >= 75 ? "#ffd166" : "#ffb4ab";
    const streak = student ? computeAttendanceStreak(getStudentAttendanceRecords(student.id)) : null;
    const showAbsenceWarning = pct !== null && pct < 75;
    const ringDeg = pct !== null ? Math.round(pct / 100 * 360) : 0;
    const lvlInfo = _rfidLevelProgress(student);
    const rankInfo = _rfidClassRank(student);
    const equippedTitle = student && typeof tsGetEquippedTitle === "function" ? tsGetEquippedTitle(student.id) : null;
    const hasStatsPanel = student && student.coins != null || rankInfo;
    return `
    <div class="kiosk-dashboard">
      <div class="kiosk-welcome-banner">
        <div class="kiosk-welcome-icon">${!alreadyRecorded ? "\u2705" : "\u{1F44B}"}</div>
        <div class="kiosk-welcome-copy">
          <div class="kiosk-welcome-kicker">${!alreadyRecorded ? "Scan Successful" : "Already Checked In"}</div>
          <div class="kiosk-welcome-text">${_rfidWelcomeMessage(name, status, streak, alreadyRecorded)}</div>
        </div>
      </div>

      <div class="kiosk-dashboard-grid${pct === null ? " kiosk-dashboard-grid-single" : ""}">
        <div class="kiosk-panel kiosk-identity-panel">
          ${student && student.profilePic ? `<img class="kiosk-profile-avatar" src="${_esc(student.profilePic)}" alt="" />` : `<div class="kiosk-profile-avatar" style="background:${avatarColor}22;color:${avatarColor};border-color:${avatarColor}44">${_esc(initials)}</div>`}
          <div class="kiosk-identity-info">
            <div class="kiosk-profile-name">${_esc(name || "Student")}</div>
            <div class="kiosk-name-accent"></div>
            ${student ? `<div class="kiosk-profile-section">Section: ${_esc(typeof getClassLabel === "function" ? getClassLabel(student.classId) : student.classId)}</div>` : ""}
            <div>
              <div class="kiosk-status-badge" style="background:${badgeColor}22;color:${badgeColor};border:2px solid ${badgeColor}55">
                ${icons[status] || "\u2705"} ${_esc(status)}${alreadyRecorded ? " \xB7 already logged today" : ""}
              </div>
              ${streak && streak.current > 0 ? `<div class="kiosk-streak-pill">\u{1F525} ${streak.current}-day streak</div>` : ""}
            </div>
            ${lvlInfo ? `
            <div class="kiosk-level-block">
              <div class="kiosk-level-label"><span>Level ${lvlInfo.lvl}</span><span>${lvlInfo.xp.toLocaleString()} / ${lvlInfo.xpNext.toLocaleString()} XP</span></div>
              <div class="kiosk-level-track"><div class="kiosk-level-fill" style="width:${lvlInfo.pct}%"></div></div>
              ${equippedTitle ? `<div class="kiosk-equipped-title"><div class="kiosk-equipped-label">Equipped Title</div>${tsBuildBadgeHTML(equippedTitle, { noParticles: true })}</div>` : ""}
            </div>` : ""}
          </div>
        </div>

        ${pct !== null ? `
        <div class="kiosk-panel kiosk-attendance-panel" style="--ring-color:${pctColor}">
          <div class="kiosk-ring" style="--ring-deg:${ringDeg}deg;--ring-color:${pctColor}">
            <div class="kiosk-ring-inner">
              <div class="kiosk-ring-pct">${pct}<span>%</span></div>
              <div class="kiosk-ring-label">Cumulative<br>Attendance</div>
            </div>
          </div>
          ${showAbsenceWarning ? `<div class="kiosk-absence-warning">\u26A0\uFE0F Below 75% \u2014 worth checking in with this student.</div>` : ""}
        </div>` : ""}

        ${pct !== null && hasStatsPanel ? `
        <div class="kiosk-panel kiosk-stats-panel">
          ${student && student.coins != null ? `
          <div class="kiosk-stat-chip kiosk-stat-chip-coins">
            <div class="kiosk-stat-label">Coins</div>
            <div class="kiosk-stat-value">\u{1FA99} ${Number(student.coins || 0).toLocaleString()}</div>
          </div>` : ""}
          ${rankInfo ? `
          <div class="kiosk-stat-chip kiosk-stat-chip-rank">
            <div class="kiosk-stat-label">Class Rank</div>
            <div class="kiosk-stat-value">#${rankInfo.rank} <span>of ${rankInfo.of}</span></div>
          </div>` : ""}
        </div>` : ""}
      </div>
    </div>`;
  }
  function _rfidRenderSpotlight(mode, data) {
    const el = document.getElementById("kiosk-spotlight");
    if (!el) return;
    data = data || {};
    clearTimeout(window._rfidSpotlightResetTimer);
    if (mode === "idle") {
      el.innerHTML = _rfidSpotlightIdleHtml();
      return;
    }
    if (mode === "loading") {
      el.innerHTML = `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">\u23F3</div>
        <div class="kiosk-spotlight-idle-text">${_esc(data.text || "Checking card\u2026")}</div>
      </div>`;
      return;
    }
    if (mode === "message") {
      el.innerHTML = `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">${_esc(data.icon || "\u2139\uFE0F")}</div>
        <div class="kiosk-spotlight-idle-text" style="color:${data.color || "inherit"}">${_esc(data.text || "")}</div>
        ${data.rawTag ? `<div class="kiosk-spotlight-raw-tag">Raw ID read: <code>${_esc(data.rawTag)}</code></div>` : ""}
      </div>`;
      window._rfidSpotlightResetTimer = setTimeout(function() {
        _rfidRenderSpotlight("idle");
      }, 5200);
      return;
    }
    if (mode === "error") {
      el.innerHTML = `
      <div class="kiosk-spotlight-error">
        <div class="kiosk-spotlight-error-icon">\u{1F6AB}</div>
        <div class="kiosk-spotlight-error-text">${_esc(data.message || "Scan failed.")}</div>
        ${data.rawTag ? `<div class="kiosk-spotlight-raw-tag">Raw ID read: <code>${_esc(data.rawTag)}</code></div>` : ""}
      </div>`;
      window._rfidSpotlightResetTimer = setTimeout(function() {
        _rfidRenderSpotlight("idle");
      }, 3200);
      return;
    }
    if (mode === "closed") {
      el.innerHTML = `
      <div class="kiosk-spotlight-closed">
        <div class="kiosk-spotlight-closed-icon">\u{1F512}</div>
        <div class="kiosk-spotlight-closed-text">Attendance Window Closed</div>
        <div class="kiosk-spotlight-closed-sub">${_esc(data.message || "Use the Manual Override on the Live Classroom Monitor instead.")}</div>
      </div>`;
      window._rfidSpotlightResetTimer = setTimeout(function() {
        _rfidRenderSpotlight("idle");
      }, 3200);
      return;
    }
    if (mode === "profile") {
      el.innerHTML = _rfidProfileCardHtml(data.student, data.status, data.alreadyRecorded, data.fallbackName);
      window._rfidSpotlightResetTimer = setTimeout(function() {
        _rfidRenderSpotlight("idle");
      }, 5e3);
      return;
    }
  }
  function _rfidTodayISO() {
    return isoDate();
  }
  function _rfidRenderActivity() {
    const statsEl = document.getElementById("kiosk-roster-stats");
    const summaryEl = document.getElementById("kiosk-activity-summary");
    const listEl = document.getElementById("kiosk-activity-list");
    if (!summaryEl || !listEl) return;
    const today = _rfidTodayISO();
    const students = AppStore.getSlice((s) => s.students) || [];
    const todaysLogs = AppStore.getSlice((s) => (s.attendanceLogs || []).filter(
      (l) => l.classId === _rfidSelectedClassId && l.logDate === today
    ));
    const by = { "Early": 0, "On Time": 0, "Late": 0, "Absent": 0, "Excused": 0 };
    todaysLogs.forEach((l) => {
      if (by[l.status] !== void 0) by[l.status]++;
    });
    const colors = { "Early": "#7fd8ff", "On Time": "#4edea3", "Late": "#ffd166", "Absent": "#ffb4ab", "Excused": "#c4b5fd" };
    if (statsEl) {
      const enrolledCount = students.filter((s) => (s.classId || "default-class") === _rfidSelectedClassId).length;
      const presentCount = by["Early"] + by["On Time"];
      const lateCount = by["Late"];
      const loggedCount = todaysLogs.length;
      const notCheckedInCount = Math.max(0, enrolledCount - loggedCount);
      statsEl.innerHTML = `
      <div class="kiosk-roster-stat">
        <div class="kiosk-roster-stat-value">${enrolledCount}</div>
        <div class="kiosk-roster-stat-label">Total</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-present">
        <div class="kiosk-roster-stat-value">${presentCount}</div>
        <div class="kiosk-roster-stat-label">Present</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-late">
        <div class="kiosk-roster-stat-value">${lateCount}</div>
        <div class="kiosk-roster-stat-label">Late</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-pending">
        <div class="kiosk-roster-stat-value">${notCheckedInCount}</div>
        <div class="kiosk-roster-stat-label">Not Checked In</div>
      </div>`;
    }
    summaryEl.innerHTML = ["Early", "On Time", "Late", "Absent", "Excused"].filter((k) => by[k] > 0).map((k) => `<span style="color:${colors[k]};font-weight:800">${by[k]}</span> ${_esc(k)}`).join(' <span style="opacity:.35">\xB7</span> ') || "No scans yet today";
    const last10 = todaysLogs.slice().sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt)).slice(0, 10);
    listEl.innerHTML = last10.length ? last10.map((l) => {
      const student = students.find((s) => s.id === l.studentId);
      const name = student ? student.name || student.displayName : l.studentId;
      const initials = student && student.init || String(name || "?").trim().slice(0, 2).toUpperCase();
      const avatarColor = _cssColor(student && student.color);
      const color = colors[l.status] || "var(--text-muted)";
      return `
      <div class="kiosk-activity-item">
        ${student && student.profilePic ? `<img class="kiosk-activity-avatar" src="${_esc(student.profilePic)}" alt="" />` : `<div class="kiosk-activity-avatar" style="background:${avatarColor}22;color:${avatarColor}">${_esc(initials)}</div>`}
        <div class="kiosk-activity-main">
          <div class="kiosk-activity-name">${_esc(name)}</div>
          <div class="kiosk-activity-meta" style="color:${color}">${_esc(l.status)}${l.entryMethod === "Manual" ? " \xB7 manual" : ""}</div>
        </div>
        <div class="kiosk-activity-time">${_esc(new Date(l.scannedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }))}</div>
      </div>`;
    }).join("") : `<div class="kiosk-activity-empty">No scans yet today</div>`;
  }
  var _rfidSetMode = function(mode) {
    _rfidScanMode = mode;
    _rfidAssignTargetStudentId = null;
    window.renderRfidScanner();
    if (document.getElementById("rfid-settings-panel")) window._rfidOpenSettings();
  };
  var _rfidOpenAssignPicker = function() {
    const students = AppStore.getSlice((s) => s.students) || [];
    _rfidAssignTargetStudentId = students[0] ? students[0].id : null;
    _rfidSetMode("assign");
  };
  var _rfidOnClassChange = function(classId) {
    _rfidSelectedClassId = classId;
    window.renderRfidScanner();
  };
  var _rfidOpenSettings = function() {
    const students = AppStore.getSlice((s) => s.students) || [];
    showModal(`
    <h3 style="margin-bottom:4px">\u2699\uFE0F Kiosk Settings</h3>
    <div id="rfid-settings-panel" style="color:var(--text-muted);font-size:12px;margin-bottom:18px">Class: ${_esc(window.getClassLabel ? window.getClassLabel(_rfidSelectedClassId, AppStore.getState()) : _rfidSelectedClassId)}</div>

    <div style="margin-bottom:20px">
      <label class="form-label">Scan Mode</label>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn ${_rfidScanMode === "attendance" ? "btn-primary" : ""}" onclick="_rfidSetMode('attendance')">\u{1F4E1} Attendance Mode</button>
        <button class="btn ${_rfidScanMode === "assign" ? "btn-primary" : ""}" onclick="_rfidOpenAssignPicker()">\u{1FAAA} Assign Card</button>
      </div>
      ${_rfidScanMode === "assign" ? `
      <div style="margin-top:12px;background:rgba(255,255,255,.03);border-radius:10px;padding:12px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text-muted);font-weight:700;margin-bottom:8px;letter-spacing:.06em">ASSIGNING NEXT SCANNED CARD TO</div>
        <select id="rfid-assign-student" style="width:100%" onchange="_rfidAssignTargetStudentId=this.value">
          ${students.map((s) => `<option value="${s.id}" ${s.id === _rfidAssignTargetStudentId ? "selected" : ""}>${_esc(s.name)}</option>`).join("")}
        </select>
      </div>` : ""}
    </div>

    <div style="margin-bottom:20px">
      <label class="form-label">\u23F0 Default Schedule \u2014 ${_esc(window.getClassLabel ? window.getClassLabel(_rfidSelectedClassId, AppStore.getState()) : _rfidSelectedClassId)}</label>
      <div style="margin-top:8px">${_rfidRenderScheduleForm()}</div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">
        This is the whole-week default. Per-day overrides (e.g. a shorter Friday) and
        every other section setting live in
        <a style="color:var(--primary);font-weight:700;cursor:pointer;text-decoration:none" onclick="closeModalForce();navTo('a-sections')">Section Maker \u2192</a>
      </div>
    </div>

    <div style="border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:space-between;align-items:center">
      <button class="btn btn-danger" onclick="_rfidCloseSession()">\u{1F512} Close Session</button>
      <button class="btn" onclick="closeModalForce()">Done</button>
    </div>
  `, "md");
  };
  function _rfidRenderScheduleForm() {
    const sched = AppStore.getSlice((s) => (s.attendanceSchedules || []).find((x) => x.classId === _rfidSelectedClassId && (x.dayOfWeek || 0) === 0));
    const v = sched || { openTime: "07:00", startTime: "07:30", lateCutoff: "07:45", closeTime: "08:30" };
    return `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;align-items:end">
      <div><label class="form-label">Opens</label><input type="time" id="rfid-sched-open" value="${_esc(v.openTime)}"></div>
      <div><label class="form-label">Start (On Time from)</label><input type="time" id="rfid-sched-start" value="${_esc(v.startTime)}"></div>
      <div><label class="form-label">Late cutoff</label><input type="time" id="rfid-sched-late" value="${_esc(v.lateCutoff)}"></div>
      <div><label class="form-label">Closes</label><input type="time" id="rfid-sched-close" value="${_esc(v.closeTime)}"></div>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="_rfidSaveSchedule()">Save Schedule</button>`;
  }
  var _rfidSaveSchedule = async function() {
    const times = {
      openTime: document.getElementById("rfid-sched-open").value,
      startTime: document.getElementById("rfid-sched-start").value,
      lateCutoff: document.getElementById("rfid-sched-late").value,
      closeTime: document.getElementById("rfid-sched-close").value
    };
    const result = await AttendanceService.upsertSchedule(_rfidSelectedClassId, times, 0);
    if (!result.ok) {
      toast(result.error || "Could not save schedule.", "#ffb4ab");
      return;
    }
    toast("\u23F0 Schedule saved", "#4edea3");
  };
  var _rfidCloseSession = async function() {
    if (!confirm(`Close today's attendance for "${_rfidSelectedClassId}"? Every student with no scan will be marked Absent.`)) return;
    const result = await AttendanceService.closeAttendanceSession(_rfidSelectedClassId);
    if (!result.ok) {
      toast(result.error || "Could not close session.", "#ffb4ab");
      return;
    }
    closeModalForce();
    toast(`\u{1F512} Session closed \u2014 ${result.absencesRecorded} marked Absent`, "#4edea3");
  };
  console.log("[EduQuest] attendance/att_scanner_rfid.js loaded \u2014 renderRfidScanner, unmountRfidScanner registered (Phase 4 kiosk).");
  window._rfidNormalizeTagId = _rfidNormalizeTagId;

  // build/test-helpers/att_scanner_rfid-combined-entry.js
  window.AppStore = AppStore;
  window.DBService = DBService2;
  window.AttendanceService = AttendanceService;
  Object.keys(att_scanner_rfid_exports).forEach((k) => {
    window[k] = att_scanner_rfid_exports[k];
  });
})();
