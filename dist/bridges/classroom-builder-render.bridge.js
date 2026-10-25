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

  // src/utils.js
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function _cssColor(s, fallback) {
    fallback = fallback || "#8b5cf6";
    const v = String(s || "").trim();
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    if (/^var\(--[a-zA-Z0-9-]+\)$/.test(v)) return v;
    return fallback;
  }
  function isoDate() {
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  }

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

  // src/modules/seat-arrangement/classroom-service.js
  var ClassroomService = (function() {
    "use strict";
    const STATUS_COLOR = {
      "Early": { bg: "rgba(78,222,163,0.25)", border: "#4edea3", label: "\u{1F7E2}" },
      "On Time": { bg: "rgba(78,222,163,0.25)", border: "#4edea3", label: "\u{1F7E2}" },
      "Late": { bg: "rgba(255,185,95,0.25)", border: "#ffb95f", label: "\u{1F7E1}" },
      "Absent": { bg: "rgba(255,180,171,0.25)", border: "#ffb4ab", label: "\u{1F534}" },
      "Excused": { bg: "rgba(147,197,253,0.25)", border: "#93c5fd", label: "\u{1F535}" },
      "_no_log": { bg: "rgba(78,75,102,0.5)", border: "rgba(255,255,255,0.12)", label: "\u26AA" },
      "_empty": { bg: "rgba(42,40,54,0.6)", border: "rgba(255,255,255,0.06)", label: "\u2014" }
    };
    function _mapLayout(row) {
      return {
        id: row.id,
        classId: row.class_id,
        name: row.name,
        roomData: row.room_data || [],
        shape: row.shape || "custom",
        walkwayPreset: row.walkway_preset || "traditional",
        seatOverlapFixed: !!row.seat_overlap_fixed,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    function _mapSeat(row) {
      return {
        id: row.id,
        layoutId: row.layout_id,
        xCoord: row.x_coord,
        yCoord: row.y_coord,
        rotation: row.rotation || 0,
        label: row.label || null,
        isLocked: !!row.is_locked
      };
    }
    function _mapAssignment(row) {
      return {
        id: row.id,
        seatId: row.seat_id,
        layoutId: row.layout_id,
        studentId: row.student_id,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by
      };
    }
    function _upsertLayout(draft, layout) {
      if (!Array.isArray(draft.classroomLayouts)) draft.classroomLayouts = [];
      const idx = draft.classroomLayouts.findIndex((l) => l.id === layout.id);
      if (idx >= 0) draft.classroomLayouts[idx] = layout;
      else draft.classroomLayouts.unshift(layout);
    }
    function _replaceSeatsForLayout(draft, layoutId, seats) {
      if (!Array.isArray(draft.seats)) draft.seats = [];
      draft.seats = draft.seats.filter((s) => s.layoutId !== layoutId);
      draft.seats.push(...seats);
    }
    function _applyAffected(draft, affected, layoutId) {
      if (!Array.isArray(draft.seatAssignments)) draft.seatAssignments = [];
      (affected || []).forEach((item) => {
        draft.seatAssignments = draft.seatAssignments.filter((a) => a.seatId !== item.seat_id);
        if (item.student_id) {
          draft.seatAssignments = draft.seatAssignments.filter(
            (a) => !(a.studentId === item.student_id && a.layoutId === layoutId)
          );
          draft.seatAssignments.push({
            id: null,
            seatId: item.seat_id,
            layoutId,
            studentId: item.student_id,
            assignedAt: (/* @__PURE__ */ new Date()).toISOString(),
            assignedBy: null
          });
        }
      });
    }
    async function saveLayout(classId, layoutName, seatsArray, propsArray, layoutId) {
      if (!classId || !layoutName) {
        return { ok: false, error: "classId and layoutName are required." };
      }
      const seatsForRpc = (seatsArray || []).map((s) => ({
        id: s.id || null,
        x_coord: s.xCoord,
        y_coord: s.yCoord,
        rotation: s.rotation || 0,
        label: s.label || null,
        is_locked: !!s.isLocked
      }));
      const { data, error } = await DBService2.rpc("save_classroom_layout", {
        p_layout_id: layoutId || null,
        p_class_id: classId,
        p_name: layoutName,
        p_room_data: propsArray || [],
        p_seats: seatsForRpc
      });
      if (error) {
        console.error("[ClassroomService] saveLayout failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not save layout." };
      }
      const layout = _mapLayout(data.layout);
      const seats = (data.seats || []).map(_mapSeat);
      AppStore.updateState((draft) => {
        _upsertLayout(draft, layout);
        _replaceSeatsForLayout(draft, layout.id, seats);
        if (Array.isArray(draft.seatAssignments)) {
          const validSeatIds = new Set(seats.map((s) => s.id));
          draft.seatAssignments = draft.seatAssignments.filter(
            (a) => a.layoutId !== layout.id || validSeatIds.has(a.seatId)
          );
        }
      }, { type: "classroom:layout-saved", payload: { classId, layoutId: layout.id } });
      return { ok: true, layoutId: layout.id, seats };
    }
    async function assignStudentToSeat(studentId, seatId, layoutId) {
      if (!seatId || !layoutId) {
        return { ok: false, error: "seatId and layoutId are required." };
      }
      const assignedBy = typeof currentUser !== "undefined" && currentUser ? currentUser.id : null;
      const { data, error } = await DBService2.rpc("assign_student_to_seat", {
        p_seat_id: seatId,
        p_layout_id: layoutId,
        p_student_id: studentId || null,
        p_assigned_by: assignedBy
      });
      if (error) {
        console.error("[ClassroomService] assignStudentToSeat failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not assign seat." };
      }
      AppStore.updateState((draft) => {
        _applyAffected(draft, data.affected, layoutId);
      }, {
        type: "classroom:seat-assigned",
        payload: { seatId, layoutId, studentId }
      });
      return { ok: true, affected: data.affected };
    }
    async function generateBlueprint(layoutId, classId, name, shape, rows, cols, spacing, preset) {
      if (!classId || !shape) {
        return { ok: false, error: "classId and shape are required." };
      }
      if (!["grid", "u_shape", "group_pods"].includes(shape)) {
        return { ok: false, error: "shape must be grid, u_shape, or group_pods." };
      }
      if (!rows || rows < 1 || !cols || cols < 1) {
        return { ok: false, error: "rows and cols must each be at least 1." };
      }
      const normalizedPreset = ["traditional", "center_aisle", "double_aisle"].includes(preset) ? preset : "traditional";
      if (shape === "grid" && normalizedPreset === "center_aisle" && cols < 2) {
        return { ok: false, error: "Center Aisle Split needs at least 2 columns." };
      }
      if (shape === "grid" && normalizedPreset === "double_aisle" && cols < 3) {
        return { ok: false, error: "Double Aisle Split needs at least 3 columns." };
      }
      const { data, error } = await DBService2.rpc("generate_room_blueprint", {
        p_layout_id: layoutId || null,
        p_class_id: classId,
        p_name: name || null,
        p_shape: shape,
        p_rows: rows,
        p_cols: cols,
        p_spacing: spacing || 80,
        p_preset: normalizedPreset
      });
      if (error) {
        console.error("[ClassroomService] generateBlueprint failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not generate blueprint." };
      }
      const layout = _mapLayout(data.layout);
      const generatedSeats = (data.generated_seats || []).map(_mapSeat);
      AppStore.updateState((draft) => {
        _upsertLayout(draft, layout);
        if (!Array.isArray(draft.seats)) draft.seats = [];
        const lockedExisting = draft.seats.filter((s) => s.layoutId === layout.id && s.isLocked);
        draft.seats = draft.seats.filter((s) => s.layoutId !== layout.id);
        draft.seats.push(...lockedExisting, ...generatedSeats);
        if (Array.isArray(draft.seatAssignments)) {
          const validSeatIds = new Set(draft.seats.filter((s) => s.layoutId === layout.id).map((s) => s.id));
          draft.seatAssignments = draft.seatAssignments.filter(
            (a) => a.layoutId !== layout.id || validSeatIds.has(a.seatId)
          );
        }
      }, { type: "classroom:blueprint-generated", payload: { layoutId: layout.id, shape, rows, cols } });
      return {
        ok: true,
        layoutId: layout.id,
        generatedSeats,
        preservedLockedCount: data.preserved_locked_count || 0
      };
    }
    async function manualMoveStudent(studentId, targetSeatId, layoutId) {
      if (!studentId || !layoutId) {
        return { ok: false, error: "studentId and layoutId are required." };
      }
      const assignedBy = typeof currentUser !== "undefined" && currentUser ? currentUser.id : null;
      const { data, error } = await DBService2.rpc("manual_move_student", {
        p_student_id: studentId,
        p_target_seat_id: targetSeatId || null,
        p_layout_id: layoutId,
        p_assigned_by: assignedBy
      });
      if (error) {
        console.error("[ClassroomService] manualMoveStudent failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not move student." };
      }
      AppStore.updateState((draft) => {
        _applyAffected(draft, data.affected, layoutId);
      }, {
        type: "classroom:manual-move",
        payload: { studentId, targetSeatId, layoutId, swapped: !!data.swapped }
      });
      return { ok: true, affected: data.affected, swapped: !!data.swapped, note: data.note || null };
    }
    async function autoAllocateRemaining(layoutId, unassignedStudentIds, strategy) {
      if (!layoutId) return { ok: false, error: "layoutId is required." };
      if (!Array.isArray(unassignedStudentIds) || unassignedStudentIds.length === 0) {
        return { ok: false, error: "unassignedStudentIds must be a non-empty array." };
      }
      const normalizedStrategy = strategy === "random" ? "random" : "alphabetical";
      const assignedBy = typeof currentUser !== "undefined" && currentUser ? currentUser.id : null;
      const { data, error } = await DBService2.rpc("auto_allocate_remaining", {
        p_layout_id: layoutId,
        p_student_ids: unassignedStudentIds,
        p_strategy: normalizedStrategy,
        p_assigned_by: assignedBy
      });
      if (error) {
        console.error("[ClassroomService] autoAllocateRemaining failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not auto-allocate seats." };
      }
      AppStore.updateState((draft) => {
        _applyAffected(draft, data.affected, layoutId);
      }, {
        type: "classroom:auto-allocate",
        payload: { layoutId, strategy: normalizedStrategy, placedCount: data.placed_count || 0 }
      });
      return {
        ok: true,
        affected: data.affected,
        placedCount: data.placed_count || 0,
        unplacedRemaining: data.unplaced_remaining || 0
      };
    }
    async function setSeatLock(seatId, layoutId, isLocked) {
      if (!seatId || !layoutId) {
        return { ok: false, error: "seatId and layoutId are required." };
      }
      const { data, error } = await DBService2.rpc("set_seat_lock", {
        p_seat_id: seatId,
        p_is_locked: !!isLocked
      });
      if (error) {
        console.error("[ClassroomService] setSeatLock failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not update seat lock." };
      }
      const seat = _mapSeat(data);
      AppStore.updateState((draft) => {
        if (!Array.isArray(draft.seats)) return;
        const idx = draft.seats.findIndex((s) => s.id === seat.id);
        if (idx >= 0) draft.seats[idx] = seat;
      }, { type: "classroom:seat-lock-toggled", payload: { seatId, layoutId, isLocked: !!isLocked } });
      return { ok: true, seat };
    }
    async function markSeatOverlapFixed(layoutId) {
      if (!layoutId) return { ok: false, error: "layoutId is required." };
      const { data, error } = await DBService2.rpc("mark_seat_overlap_fixed", {
        p_layout_id: layoutId
      });
      if (error) {
        console.error("[ClassroomService] markSeatOverlapFixed failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not update layout." };
      }
      const layout = _mapLayout(data);
      AppStore.updateState((draft) => {
        _upsertLayout(draft, layout);
      }, { type: "classroom:seat-overlap-fixed", payload: { layoutId } });
      return { ok: true, layout };
    }
    async function deleteLayout(layoutId) {
      if (!layoutId) return { ok: false, error: "layoutId is required." };
      const { error } = await DBService2.rpc("delete_classroom_layout", {
        p_layout_id: layoutId
      });
      if (error) {
        console.error("[ClassroomService] deleteLayout failed:", error.message || error.code || error, error);
        return { ok: false, error: error.message || "Could not delete layout." };
      }
      AppStore.updateState((draft) => {
        if (Array.isArray(draft.classroomLayouts)) {
          draft.classroomLayouts = draft.classroomLayouts.filter((l) => l.id !== layoutId);
        }
        if (Array.isArray(draft.seats)) {
          draft.seats = draft.seats.filter((s) => s.layoutId !== layoutId);
        }
        if (Array.isArray(draft.seatAssignments)) {
          draft.seatAssignments = draft.seatAssignments.filter((a) => a.layoutId !== layoutId);
        }
      }, { type: "classroom:layout-deleted", payload: { layoutId } });
      return { ok: true };
    }
    function getLiveSeatingMap(classId, layoutId, logDate) {
      const state = AppStore.getState();
      const today = logDate || isoDate();
      const layout = (state.classroomLayouts || []).find(
        (l) => l.id === layoutId && l.classId === classId
      );
      if (!layout) return [];
      const seats = (state.seats || []).filter((s) => s.layoutId === layoutId);
      const assignments = (state.seatAssignments || []).filter((a) => a.layoutId === layoutId);
      const students = state.students || [];
      const logs = (state.attendanceLogs || []).filter((l) => l.classId === classId && l.logDate === today);
      const assignmentBySeatId = Object.fromEntries(assignments.map((a) => [a.seatId, a]));
      const studentById = Object.fromEntries(students.map((s) => [s.id, s]));
      const logByStudentId = Object.fromEntries(logs.map((l) => [l.studentId, l]));
      return seats.map((seat) => {
        const assignment = assignmentBySeatId[seat.id];
        const student = assignment ? studentById[assignment.studentId] : null;
        const log = student ? logByStudentId[student.id] : null;
        let colorKey;
        if (!student) colorKey = "_empty";
        else if (!log) colorKey = "_no_log";
        else colorKey = log.status;
        return {
          seatId: seat.id,
          layoutId: seat.layoutId,
          xCoord: seat.xCoord,
          yCoord: seat.yCoord,
          rotation: seat.rotation,
          label: seat.label,
          isLocked: !!seat.isLocked,
          studentId: student ? student.id : null,
          studentName: student ? student.name || student.displayName : null,
          studentInit: student ? student.init : null,
          studentColor: student ? student.color : null,
          studentPhoto: student ? student.profilePic : null,
          attendanceStatus: log ? log.status : null,
          color: STATUS_COLOR[colorKey] || STATUS_COLOR["_empty"]
        };
      });
    }
    function getLayoutsForClass(classId) {
      return AppStore.getSlice(
        (s) => (s.classroomLayouts || []).filter((l) => l.classId === classId)
      );
    }
    function duplicateSeats(seats, offset) {
      const delta = typeof offset === "number" && !isNaN(offset) ? offset : 30;
      return (seats || []).map((s) => ({
        id: "new_" + Math.random().toString(36).slice(2, 11),
        xCoord: s.xCoord + delta,
        yCoord: s.yCoord + delta,
        rotation: s.rotation || 0,
        label: s.label || null,
        isLocked: false,
        studentId: null
        // a duplicated seat is always unoccupied — copying a
        // student's seat assignment would put them in two
        // seats at once, which violates the one-seat rule.
      }));
    }
    function getColdCallCandidates(classId, layoutId, logDate) {
      const ELIGIBLE_STATUSES = ["Early", "On Time", "Late"];
      return getLiveSeatingMap(classId, layoutId, logDate).filter(
        (vm) => vm.studentId && ELIGIBLE_STATUSES.includes(vm.attendanceStatus)
      );
    }
    function pickRandomStudent(layoutId, strategy, targetedSeatIds) {
      if (!layoutId) return { ok: false, error: "layoutId is required." };
      const state = AppStore.getState();
      const layout = (state.classroomLayouts || []).find((l) => l.id === layoutId);
      if (!layout) return { ok: false, error: "Unknown layoutId." };
      const normalizedStrategy = ["pure_random", "least_participative", "spatial_block", "late_only"].includes(strategy) ? strategy : "pure_random";
      const targetIds = Array.isArray(targetedSeatIds) ? targetedSeatIds : [];
      let pool = getColdCallCandidates(layout.classId, layoutId);
      if (normalizedStrategy === "spatial_block") {
        const targetSet = new Set(targetIds);
        pool = pool.filter((vm) => targetSet.has(vm.seatId));
        if (pool.length === 0) {
          return {
            ok: false,
            error: targetSet.size === 0 ? "Select at least one seat to roll among first." : "None of the targeted seats currently have a present or late student in them."
          };
        }
      } else if (normalizedStrategy === "late_only") {
        pool = pool.filter((vm) => vm.attendanceStatus === "Late");
        if (pool.length === 0) {
          return { ok: false, error: "No students are currently marked Late." };
        }
      } else if (pool.length === 0) {
        return { ok: false, error: "No present or late students are currently seated." };
      }
      if (normalizedStrategy === "least_participative") {
        const recitationLog = state.recitationLog || [];
        const pointLog = state.pointLog || [];
        const countByStudent = {};
        pool.forEach((vm) => {
          const recCount = recitationLog.filter((r) => r.studentId === vm.studentId).length;
          const ptCount = pointLog.filter((p) => p.studentId === vm.studentId).length;
          countByStudent[vm.studentId] = recCount + ptCount;
        });
        const minCount = Math.min.apply(null, pool.map((vm) => countByStudent[vm.studentId]));
        pool = pool.filter((vm) => countByStudent[vm.studentId] === minCount);
      }
      const winner = pool[Math.floor(Math.random() * pool.length)];
      return { ok: true, winner, pool, strategy: normalizedStrategy };
    }
    function getUnassignedStudents(classId, layoutId) {
      const state = AppStore.getState();
      const students = (state.students || []).filter((s) => (s.classId || "default-class") === classId);
      const assignments = (state.seatAssignments || []).filter((a) => a.layoutId === layoutId);
      const assignedSet = new Set(assignments.map((a) => a.studentId));
      return students.filter((s) => !assignedSet.has(s.id));
    }
    const STATUS_COLORS = STATUS_COLOR;
    return {
      saveLayout,
      assignStudentToSeat,
      generateBlueprint,
      manualMoveStudent,
      autoAllocateRemaining,
      setSeatLock,
      markSeatOverlapFixed,
      deleteLayout,
      getLiveSeatingMap,
      getLayoutsForClass,
      getUnassignedStudents,
      duplicateSeats,
      getColdCallCandidates,
      pickRandomStudent,
      STATUS_COLORS
    };
  })();
  console.log("[EduQuest] classroom/classroom-service.js loaded \u2014 ClassroomService registered.");

  // src/modules/seat-arrangement/classroom_builder.js
  var _cbMounted = false;
  var _cbMode = "build";
  var _cbClassId = "default-class";
  var _cbLayoutId = null;
  var _cbLocalSeats = [];
  var _cbLocalProps = [];
  var _cbDragSeatId = null;
  var _cbDragStudentId = null;
  var _cbSelectedSeatIds = /* @__PURE__ */ new Set();
  var _cbDragOffsetX = 0;
  var _cbDragOffsetY = 0;
  var CB_CANVAS_W = 1200;
  var CB_CANVAS_H = 800;
  var CB_SEAT_SIZE = 120;
  var CB_SEAT_MARGIN = CB_SEAT_SIZE / 2;
  var CB_PROP_TYPES = [
    { type: "door", emoji: "\u{1F6AA}", label: "Door" },
    { type: "window", emoji: "\u{1FA9F}", label: "Window" },
    { type: "whiteboard", emoji: "\u{1F4CB}", label: "Whiteboard" },
    { type: "teacher_desk", emoji: "\u{1F5A5}\uFE0F", label: "Teacher Desk" }
  ];
  var CB_SHAPE_TYPES = [
    { shape: "grid", emoji: "\u25A6", label: "Traditional Grid", rowsLabel: "Rows", colsLabel: "Columns" },
    { shape: "u_shape", emoji: "\u2294", label: "U-Shape", rowsLabel: "Per side", colsLabel: "Across bottom" },
    { shape: "group_pods", emoji: "\u229E", label: "Group Pods", rowsLabel: "Pods", colsLabel: "Seats/pod" }
  ];
  var _cbAutoStrategy = "alphabetical";
  var _cbWizardOpen = false;
  var _cbWizardShape = "grid";
  var _cbWizardRows = 4;
  var _cbWizardCols = 6;
  var _cbWizardSpacing = 130;
  var _cbWizardPreset = "traditional";
  var CB_WALKWAY_PRESETS = [
    { preset: "traditional", label: "Traditional Block", hint: "One solid block, no walkway." },
    { preset: "center_aisle", label: "Center Aisle Split", hint: "Two blocks with one walkway down the middle." },
    { preset: "double_aisle", label: "Double Aisle Split", hint: "Three blocks with two walkways for easy pass-through." }
  ];
  (function injectClassroomCSS() {
    if (document.getElementById("classroom-builder-css")) return;
    const s = document.createElement("style");
    s.id = "classroom-builder-css";
    s.textContent = `
/* \u2500\u2500 Classroom page layout \u2500\u2500 */
#a-classroom,#s-classroom{padding:0!important;max-width:100%!important;overflow:hidden}

/* \u2500\u2500 Toolbar \u2500\u2500 */
.cb-toolbar{
  display:flex;align-items:center;gap:10px;padding:14px 20px;
  background:rgba(19,18,30,0.95);border-bottom:1px solid var(--border);
  flex-wrap:wrap;position:sticky;
  z-index:50;backdrop-filter:blur(16px);
}
.cb-toolbar-sep{width:1px;height:28px;background:var(--border);flex-shrink:0}
.cb-mode-btn{
  display:flex;align-items:center;gap:6px;padding:8px 16px;
  border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;
  border:1px solid var(--border2);background:rgba(255,255,255,.05);
  color:var(--text-muted);transition:all .18s;font-family:var(--fb);
}
.cb-mode-btn.active{
  background:rgba(208,188,255,.18);border-color:rgba(208,188,255,.4);
  color:var(--primary);box-shadow:0 0 12px rgba(139,92,246,.25);
}
.cb-mode-btn:hover:not(.active){background:rgba(255,255,255,.08);color:var(--on-surface)}
.cb-class-select{min-width:140px}
.cb-layout-select{min-width:160px}

/* \u2500\u2500 Main area: canvas + sidebar \u2500\u2500 */
.cb-workspace{
  display:flex;height:calc(100vh - 64px - 57px);overflow:hidden;
}

/* \u2500\u2500 Canvas wrapper (scales the virtual 1200\xD7800 space) \u2500\u2500 */
.cb-canvas-wrap{
  flex:1;overflow:hidden;position:relative;
  background:
    radial-gradient(circle at 50% 50%,rgba(139,92,246,0.04) 0%,transparent 70%),
    repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.03) 39px,rgba(255,255,255,0.03) 40px),
    repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.03) 39px,rgba(255,255,255,0.03) 40px);
  background-color:var(--bg-low);
  cursor:default;
}
.cb-canvas{
  position:absolute;
  transform-origin:top left;
  /* width/height set via JS based on viewport */
}

/* \u2500\u2500 Seats \u2500\u2500 */
.cb-seat{
  position:absolute;width:${CB_SEAT_SIZE}px;height:${CB_SEAT_SIZE}px;border-radius:14px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:2px solid rgba(255,255,255,.12);
  background:rgba(42,40,54,0.6);
  cursor:grab;user-select:none;
  transition:border-color .2s,background .2s,box-shadow .2s;
  font-family:var(--fh);will-change:transform;
}
.cb-seat:active{cursor:grabbing}
.cb-seat.drag-over{
  border-color:var(--primary)!important;
  box-shadow:0 0 0 2px rgba(139,92,246,.5),0 0 20px rgba(139,92,246,.3)!important;
}
.cb-seat.selected{
  border-color:var(--primary)!important;
  box-shadow:0 0 0 2px rgba(139,92,246,.35);
}
.cb-seat-init{font-size:25px;font-weight:900;line-height:1;position:relative;overflow:hidden}
.cb-seat-init img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.cb-seat-name{font-size:13px;font-weight:700;color:rgba(255,255,255,.55);
  text-align:center;max-width:105px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;margin-top:2px}
.cb-seat-status{font-size:14px;font-weight:800;letter-spacing:.04em;margin-top:1px}
.cb-seat-label{
  position:absolute;top:-10px;left:50%;transform:translateX(-50%);
  font-size:8px;font-weight:800;letter-spacing:.05em;
  background:rgba(19,18,30,.9);border:1px solid var(--border2);
  border-radius:4px;padding:1px 5px;color:var(--text-muted);
  white-space:nowrap;pointer-events:none;
}
.cb-seat-del{
  position:absolute;top:-8px;right:-8px;width:18px;height:18px;
  background:#ffb4ab;border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:10px;
  color:#1a0808;font-weight:900;z-index:10;
}
.cb-seat:hover .cb-seat-del{display:flex}

/* \u2500\u2500 Room props (doors, windows, etc.) \u2500\u2500 */
.cb-prop{
  position:absolute;width:56px;height:56px;border-radius:8px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:1px dashed rgba(255,255,255,.18);background:rgba(255,255,255,.04);
  cursor:grab;user-select:none;font-size:24px;
  transition:border-color .2s;
}
.cb-prop:hover{border-color:rgba(208,188,255,.3)}
.cb-prop-label{font-size:8px;color:var(--text-muted);font-weight:700;margin-top:2px}
.cb-prop-del{
  position:absolute;top:-8px;right:-8px;width:18px;height:18px;
  background:rgba(255,180,171,.8);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:10px;
  color:#1a0808;font-weight:900;z-index:10;
}
.cb-prop:hover .cb-prop-del{display:flex}

/* \u2500\u2500 Sidebar (student roster in assign mode) \u2500\u2500 */
.cb-sidebar{
  width:220px;flex-shrink:0;
  border-left:1px solid var(--border);
  background:rgba(35,31,56,0.85);
  display:flex;flex-direction:column;
  overflow:hidden;
}
.cb-sidebar-header{
  padding:14px 16px 10px;font-family:var(--fh);font-size:13px;font-weight:800;
  color:var(--on-surface);border-bottom:1px solid var(--border);flex-shrink:0;
}
.cb-sidebar-list{flex:1;overflow-y:auto;padding:8px}
.cb-student-chip{
  display:flex;align-items:center;gap:8px;padding:8px 10px;
  border-radius:10px;border:1px solid var(--border);
  background:rgba(255,255,255,.04);cursor:grab;
  margin-bottom:6px;transition:all .15s;
}
.cb-student-chip:hover{background:rgba(255,255,255,.08);border-color:rgba(208,188,255,.25)}
.cb-student-chip.assigned{opacity:.4;cursor:not-allowed}
.cb-student-chip.dragging{opacity:.3}
.cb-chip-avatar{
  width:32px;height:32px;border-radius:8px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:900;color:#fff;
}
.cb-chip-info{min-width:0}
.cb-chip-name{font-size:12px;font-weight:700;color:var(--on-surface);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-chip-status{font-size:10px;color:var(--text-muted);margin-top:1px}

/* \u2500\u2500 Prop palette (build mode sidebar) \u2500\u2500 */
.cb-palette{padding:12px}
.cb-palette-title{font-size:10px;font-weight:800;letter-spacing:.08em;
  text-transform:uppercase;color:var(--text-muted);margin-bottom:10px}
.cb-palette-item{
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  border-radius:10px;border:1px solid var(--border);
  background:rgba(255,255,255,.04);cursor:pointer;margin-bottom:6px;
  font-size:13px;font-weight:700;color:var(--on-surface);transition:all .15s;
}
.cb-palette-item:hover{background:rgba(255,255,255,.08);border-color:rgba(208,188,255,.25)}
.cb-add-seat-btn{
  width:100%;padding:10px;border-radius:10px;border:1px dashed rgba(208,188,255,.3);
  background:rgba(208,188,255,.06);color:var(--primary);font-family:var(--fb);
  font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;margin-bottom:10px;
}
.cb-add-seat-btn:hover{background:rgba(208,188,255,.12);border-color:rgba(208,188,255,.5)}

/* \u2500\u2500 Legend \u2500\u2500 */
.cb-legend{
  display:flex;gap:10px;flex-wrap:wrap;padding:8px 16px;
  border-top:1px solid var(--border);background:rgba(19,18,30,.8);flex-shrink:0;
}
.cb-legend-item{display:flex;align-items:center;gap:5px;font-size:10px;
  font-weight:700;color:var(--text-muted)}
.cb-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}

/* \u2500\u2500 Rotation handle \u2500\u2500 */
.cb-rotate-btn{
  position:absolute;bottom:-8px;right:-8px;width:20px;height:20px;
  background:rgba(208,188,255,.8);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:11px;z-index:10;
  color:#1a0038;font-weight:900;
}
.cb-seat:hover .cb-rotate-btn{display:flex}

/* \u2500\u2500 Drop indicator \u2500\u2500 */
.cb-canvas.drop-active .cb-canvas-wrap{cursor:copy}

/* \u2500\u2500 Empty state \u2500\u2500 */
.cb-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;pointer-events:none;
  color:rgba(255,255,255,.15);
}
.cb-empty-icon{font-size:64px;margin-bottom:16px}
.cb-empty-text{font-size:14px;font-weight:700;letter-spacing:.04em}
/* \u2500\u2500 Multi-select (Mass Seat Actions) \u2500\u2500 */
.cb-seat.selected{
  outline:3px solid var(--primary)!important;
  outline-offset:2px;
  box-shadow:0 0 0 1px rgba(208,188,255,.5),0 0 16px rgba(208,188,255,.3)!important;
  z-index:5;
}
.cb-selection-bar{
  display:flex;align-items:center;gap:8px;padding:6px 10px;
  background:rgba(208,188,255,.08);border:1px solid rgba(208,188,255,.25);
  border-radius:10px;font-size:12px;font-weight:700;color:var(--primary);
}
.cb-selection-bar .count{font-weight:900}

/* \u2500\u2500 Seat locking \u2500\u2500 */
.cb-seat.locked{
  border-color:#ffb95f!important;
  box-shadow:0 0 0 1px rgba(255,185,95,.4)!important;
}
.cb-lock-btn{
  position:absolute;bottom:-8px;left:-8px;width:18px;height:18px;
  background:rgba(255,185,95,.85);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:9px;z-index:10;
  color:#2a1a00;font-weight:900;
}
.cb-seat:hover .cb-lock-btn,.cb-seat.locked .cb-lock-btn{display:flex}
.cb-seat.locked .cb-lock-btn{background:#ffb95f}

/* \u2500\u2500 Unassigned pool sidebar (assign mode) \u2500\u2500 */
.cb-pool-zone{
  border:1px dashed rgba(255,255,255,.12);border-radius:10px;
  padding:4px;min-height:40px;transition:all .15s;
}
.cb-pool-zone.drag-over{
  border-color:var(--primary);background:rgba(208,188,255,.06);
}
.cb-auto-bar{
  display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--border);
  flex-shrink:0;flex-wrap:wrap;
}
.cb-auto-bar select{flex:1;min-width:90px}
.cb-auto-bar button{flex-shrink:0}

/* \u2500\u2500 Blueprint wizard modal \u2500\u2500 */
.cb-modal-backdrop{
  position:fixed;inset:0;background:rgba(8,7,14,.7);backdrop-filter:blur(4px);
  display:flex;align-items:center;justify-content:center;z-index:200;
}
.cb-modal{
  width:420px;max-width:92vw;background:rgba(28,26,42,.98);
  border:1px solid var(--border2);border-radius:16px;padding:24px;
  box-shadow:0 24px 60px rgba(0,0,0,.5);
}
.cb-modal-title{font-family:var(--fh);font-size:17px;font-weight:900;margin-bottom:4px}
.cb-modal-sub{font-size:12px;color:var(--text-muted);margin-bottom:18px}
.cb-shape-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.cb-shape-btn{
  padding:14px 8px;border-radius:10px;border:1px solid var(--border2);
  background:rgba(255,255,255,.04);cursor:pointer;text-align:center;
  transition:all .15s;color:var(--text-muted);
}
.cb-shape-btn .ic{font-size:22px;display:block;margin-bottom:4px}
.cb-shape-btn .lb{font-size:10px;font-weight:800}
.cb-shape-btn.active{
  border-color:var(--primary);background:rgba(208,188,255,.14);color:var(--primary);
}
.cb-field-row{display:flex;gap:10px;margin-bottom:12px}
.cb-field{flex:1}
.cb-field label{display:block;font-size:10px;font-weight:800;letter-spacing:.05em;
  text-transform:uppercase;color:var(--text-muted);margin-bottom:5px}
.cb-field input{width:100%}
.cb-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.cb-modal-hint{font-size:11px;color:var(--text-muted);line-height:1.5;margin-top:2px;margin-bottom:14px}
`;
    document.head.appendChild(s);
  })();
  function _cbCanvasScale() {
    const wrap = document.querySelector(".cb-canvas-wrap");
    if (!wrap) return 1;
    return Math.min(wrap.clientWidth / CB_CANVAS_W, wrap.clientHeight / CB_CANVAS_H);
  }
  function _cbSeatDragStart(e, seatId) {
    _cbDragSeatId = seatId;
    const seat = _cbLocalSeats.find((s) => s.id === seatId);
    const scale = _cbCanvasScale();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    _cbDragOffsetX = Math.round((e.clientX - rect.left) / scale);
    _cbDragOffsetY = Math.round((e.clientY - rect.top) / scale);
    e.dataTransfer.effectAllowed = "move";
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;top:-999px;left:-999px;width:1px;height:1px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }
  function _cbSeatDragEnd() {
    _cbDragSeatId = null;
    _cbDragOffsetX = 0;
    _cbDragOffsetY = 0;
  }
  function _cbPropDragStart(e, propIdx) {
    _cbDragSeatId = "__prop__" + propIdx;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const scale = _cbCanvasScale();
    _cbDragOffsetX = Math.round((e.clientX - rect.left) / scale);
    _cbDragOffsetY = Math.round((e.clientY - rect.top) / scale);
    e.dataTransfer.effectAllowed = "move";
  }
  function _cbPropDragEnd() {
    _cbDragSeatId = null;
    _cbDragOffsetX = 0;
    _cbDragOffsetY = 0;
  }
  function _cbSeatAssignDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.classList.add("drag-over");
  }
  function _cbSeatAssignDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }
  async function _cbSeatAssignDrop(e, seatId) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    if (!_cbDragStudentId || !seatId || !_cbLayoutId) return;
    const result = await ClassroomService.manualMoveStudent(
      _cbDragStudentId,
      seatId,
      _cbLayoutId
    );
    if (!result.ok) {
      toast("\u274C " + result.error, "#ffb4ab");
      return;
    }
    if (result.note) {
      return;
    }
    toast(result.swapped ? "\u{1F504} Seats swapped" : "\u2705 Seat assigned", "#4edea3");
  }
  function _cbSeatOccupantDragStart(e, seatId, studentId) {
    _cbDragStudentId = studentId;
    e.currentTarget.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", studentId);
  }
  function _cbSeatOccupantDragEnd(e) {
    _cbDragStudentId = null;
    e.currentTarget.classList.remove("dragging");
  }
  async function _cbUnassign(seatId) {
    if (!_cbLayoutId) return;
    const vm = ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId).find((v) => v.seatId === seatId);
    const studentId = vm ? vm.studentId : null;
    if (!studentId) return;
    const result = await ClassroomService.manualMoveStudent(studentId, null, _cbLayoutId);
    if (!result.ok) {
      toast("\u274C " + result.error, "#ffb4ab");
      return;
    }
    toast("\u2705 Seat unassigned", "#d0bcff");
  }
  console.log("[EduQuest] classroom/classroom_builder.js loaded \u2014 renderClassroomBuilder/renderStudentSeating registered.");
  window.CB_CANVAS_W = CB_CANVAS_W;
  window.CB_CANVAS_H = CB_CANVAS_H;
  window._cbClassId = _cbClassId;
  window._cbLayoutId = _cbLayoutId;
  window._cbMode = _cbMode;
  window._cbLocalSeats = _cbLocalSeats;
  window._cbSelectedSeatIds = _cbSelectedSeatIds;
  window._cbLocalProps = _cbLocalProps;
  window._cbCanvasScale = _cbCanvasScale;
  window.CB_PROP_TYPES = CB_PROP_TYPES;
  window._cbPropDragStart = _cbPropDragStart;
  window._cbPropDragEnd = _cbPropDragEnd;
  window._cbSeatDragStart = _cbSeatDragStart;
  window._cbSeatDragEnd = _cbSeatDragEnd;
  window._cbSeatAssignDragOver = _cbSeatAssignDragOver;
  window._cbSeatAssignDragLeave = _cbSeatAssignDragLeave;
  window._cbSeatAssignDrop = _cbSeatAssignDrop;
  window._cbSeatOccupantDragStart = _cbSeatOccupantDragStart;
  window._cbSeatOccupantDragEnd = _cbSeatOccupantDragEnd;
  window._cbUnassign = _cbUnassign;
  window._cbMounted = _cbMounted;
  window._cbAutoStrategy = _cbAutoStrategy;
  window._cbDragStudentId = _cbDragStudentId;
  window._cbWizardOpen = _cbWizardOpen;
  window.CB_SHAPE_TYPES = CB_SHAPE_TYPES;
  window._cbWizardShape = _cbWizardShape;
  window._cbWizardRows = _cbWizardRows;
  window._cbWizardCols = _cbWizardCols;
  window._cbWizardSpacing = _cbWizardSpacing;
  window.CB_WALKWAY_PRESETS = CB_WALKWAY_PRESETS;
  window._cbWizardPreset = _cbWizardPreset;

  // src/modules/seat-arrangement/classroom-builder-render.js
  function _cbRenderShell2(page, classIds, state) {
    const layouts = (state.classroomLayouts || []).filter((l) => l.classId === _cbClassId);
    page.innerHTML = `
  <!-- TOOLBAR -->
  <div class="cb-toolbar">
    <select class="cb-class-select" onchange="window._cbOnClassChange(this.value)">${classIds.map((c) => `<option value="${_esc(c)}"${c === _cbClassId ? " selected" : ""}>${_esc(window.getClassLabel ? window.getClassLabel(c, state) : c)}</option>`).join("")}</select>

    <div class="cb-toolbar-sep"></div>

    <select class="cb-layout-select" id="cb-layout-select" onchange="window._cbOnLayoutChange(this.value)">${layouts.length ? layouts.map((l) => `<option value="${_esc(l.id)}"${l.id === _cbLayoutId ? " selected" : ""}>${_esc(l.name)}</option>`).join("") : `<option value="">\u2014 No layouts yet \u2014</option>`}</select>
    <button class="btn btn-ghost btn-sm" onclick="window._cbNewLayout()">\uFF0B New</button>
    <button class="btn btn-ghost btn-sm" onclick="window._cbOpenBlueprintWizard()" title="Generate a structural room layout">\u{1F4D0} Blueprint</button>
    ${_cbLayoutId ? `<button class="btn btn-ghost btn-sm" onclick="window._cbRenameLayout()">\u270F\uFE0F Rename</button>` : ""}
    ${_cbLayoutId ? `<button class="btn btn-danger btn-sm" onclick="window._cbDeleteLayout()">\u{1F5D1}</button>` : ""}

    <div class="cb-toolbar-sep"></div>

    <button class="cb-mode-btn ${_cbMode === "build" ? "active" : ""}" onclick="window._cbSetMode('build')">
      \u{1F9F1} Build Mode
    </button>
    <button class="cb-mode-btn ${_cbMode === "assign" ? "active" : ""}" onclick="window._cbSetMode('assign')" ${!_cbLayoutId ? "disabled" : ""}>
      \u{1FA91} Assign Mode
    </button>

    <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
      ${_cbMode === "build" ? `
        <span style="font-size:11px;color:var(--text-muted);font-weight:700">
          ${_cbLocalSeats.length} seat${_cbLocalSeats.length !== 1 ? "s" : ""}
        </span>
        <button class="btn btn-primary btn-sm" onclick="window._cbSave()" ${!_cbLayoutId && _cbLocalSeats.length === 0 ? "disabled" : ""}>
          \u{1F4BE} Save Layout
        </button>
      ` : `
        <span style="font-size:11px;color:var(--text-muted);font-weight:700">
          Drag students \u2192 seats
        </span>
      `}
    </div>
  </div>

  ${_cbMode === "build" && _cbLocalSeats.length > 0 ? `
  <!-- MASS SEAT ACTIONS (build mode only) -->
  <div class="cb-toolbar" style="padding-top:4px;padding-bottom:4px">
    <button class="btn btn-ghost btn-sm" onclick="window._cbSelectAllSeats()" title="Select every seat on the canvas">\u2611\uFE0F Select All</button>
    <button class="btn btn-ghost btn-sm" onclick="window._cbClearSeatSelection()" ${_cbSelectedSeatIds.size === 0 ? "disabled" : ""}>\u2716\uFE0F Clear Selection</button>
    <div class="cb-toolbar-sep"></div>
    <button class="btn btn-primary btn-sm" onclick="window._cbDuplicateSelectedSeats()" ${_cbSelectedSeatIds.size === 0 ? "disabled" : ""}
      title="Clone the selected seats, offset by 30px so they don't stack on the originals">
      \u{1F4D1} Duplicate Selected
    </button>
    ${_cbSelectedSeatIds.size > 0 ? `
      <div class="cb-selection-bar">
        <span class="count">${_cbSelectedSeatIds.size}</span> selected
      </div>
    ` : `
      <span style="font-size:11px;color:var(--text-muted)">Shift-click seats to select multiple</span>
    `}
  </div>
  ` : ""}

  <!-- WORKSPACE -->
  <div class="cb-workspace">
    <!-- CANVAS WRAP -->
    <div class="cb-canvas-wrap" id="cb-canvas-wrap"
      ondragover="window._cbOnCanvasDragOver(event)"
      ondrop="window._cbOnCanvasDrop(event)"
      ondragleave="window._cbOnCanvasDragLeave(event)">
      <div class="cb-canvas" id="cb-canvas"></div>
      <div class="cb-empty" id="cb-empty" style="display:${_cbLocalSeats.length || _cbLocalProps.length ? "none" : "flex"}">
        <div class="cb-empty-icon">\u{1FA91}</div>
        <div class="cb-empty-text">${_cbMode === "build" ? "Add seats from the panel \u2192" : "No layout to display"}</div>
      </div>
    </div>

    <!-- SIDEBAR -->
    <div class="cb-sidebar" id="cb-sidebar"></div>
  </div>

  <!-- LEGEND -->
  <div class="cb-legend">
    ${Object.entries(ClassroomService.STATUS_COLORS).map(([k, v]) => `
      <div class="cb-legend-item">
        <div class="cb-legend-dot" style="background:${v.border};opacity:.8"></div>
        ${k === "_no_log" ? "No scan yet" : k === "_empty" ? "Empty seat" : k}
      </div>
    `).join("")}
  </div>

  <!-- MODAL MOUNT (blueprint wizard, etc.) -->
  <div id="cb-modal-root"></div>
  `;
    _cbScaleCanvas2();
    _cbRenderCanvas2();
    _cbRenderSidebar2();
    _cbRenderWizard2();
    window.addEventListener("resize", _cbScaleCanvas2);
  }
  function _cbScaleCanvas2() {
    const canvas = document.getElementById("cb-canvas");
    const wrap = document.getElementById("cb-canvas-wrap");
    if (!canvas || !wrap) return;
    const scale = _cbCanvasScale();
    if (!isFinite(scale) || scale <= 0) {
      requestAnimationFrame(_cbScaleCanvas2);
      return;
    }
    canvas.style.width = CB_CANVAS_W + "px";
    canvas.style.height = CB_CANVAS_H + "px";
    canvas.style.transform = `scale(${scale})`;
  }
  function _cbRenderCanvas2() {
    const canvas = document.getElementById("cb-canvas");
    if (!canvas) return;
    const seatingMap = _cbLayoutId ? ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId) : [];
    const mapBySeatId = Object.fromEntries(seatingMap.map((s) => [s.seatId, s]));
    canvas.querySelectorAll(".cb-seat,.cb-prop").forEach((el) => el.remove());
    _cbLocalProps.forEach((prop, idx) => {
      const el = document.createElement("div");
      el.className = "cb-prop";
      el.dataset.propIdx = idx;
      el.style.left = prop.x + "px";
      el.style.top = prop.y + "px";
      el.style.transform = `rotate(${prop.rotation || 0}deg)`;
      el.draggable = _cbMode === "build";
      el.innerHTML = `
      <span>${CB_PROP_TYPES.find((t) => t.type === prop.type)?.emoji || "\u{1F4E6}"}</span>
      <span class="cb-prop-label">${CB_PROP_TYPES.find((t) => t.type === prop.type)?.label || prop.type}</span>
      ${_cbMode === "build" ? `<button class="cb-prop-del" onclick="window._cbDeleteProp(${idx})" title="Remove">\u2715</button>` : ""}
    `;
      if (_cbMode === "build") {
        el.addEventListener("dragstart", (e) => _cbPropDragStart(e, idx));
        el.addEventListener("dragend", _cbPropDragEnd);
      }
      canvas.appendChild(el);
    });
    _cbLocalSeats.forEach((seat) => {
      const vm = mapBySeatId[seat.id] || {};
      const col = vm.color || ClassroomService.STATUS_COLORS["_empty"];
      const el = document.createElement("div");
      el.className = "cb-seat" + (seat.isLocked ? " locked" : "") + (_cbSelectedSeatIds.has(seat.id) ? " selected" : "");
      el.dataset.seatId = seat.id;
      el.style.left = seat.xCoord + "px";
      el.style.top = seat.yCoord + "px";
      el.style.transform = `translate(-50%,-50%) rotate(${seat.rotation || 0}deg)`;
      el.style.background = col.bg;
      el.style.borderColor = seat.isLocked ? "#ffb95f" : col.border;
      const studentColor = vm.studentColor || "rgba(139,92,246,0.5)";
      const initText = vm.studentInit || (vm.studentId ? "?" : "");
      const statusText = vm.attendanceStatus || (vm.studentId ? "\u2014" : "");
      el.innerHTML = `
      ${seat.label ? `<div class="cb-seat-label">${_esc(seat.label)}</div>` : ""}
      ${vm.studentId ? `<div class="cb-seat-init" style="width:57px;height:57px;border-radius:9px;background:${studentColor};display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:900">${vm.studentPhoto ? `<img src="${_esc(vm.studentPhoto)}" alt="" onerror="this.remove()">` : ""}${_esc(initText)}</div>
           <div class="cb-seat-name">${_esc(vm.studentName || "")}</div>
           <div class="cb-seat-status" style="color:${col.border}">${statusText}</div>` : `<div style="font-size:30px;opacity:.3">\u{1FA91}</div>`}
      ${_cbMode === "build" ? `<button class="cb-seat-del" onclick="window._cbDeleteSeat('${seat.id}')" title="Remove seat">\u2715</button>
           <button class="cb-rotate-btn" onclick="window._cbRotateSeat('${seat.id}')" title="Rotate">\u21BB</button>` : ""}
      ${_cbMode === "assign" ? `<button class="cb-lock-btn" onclick="window._cbToggleSeatLock(event,'${seat.id}')"
             title="${seat.isLocked ? "Unlock \u2014 let auto-allocate/blueprint touch this seat again" : "Lock \u2014 protect this seat from auto-allocate and blueprint regeneration"}">
             ${seat.isLocked ? "\u{1F512}" : "\u{1F513}"}
           </button>` : ""}
    `;
      if (_cbMode === "build") {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => _cbSeatDragStart(e, seat.id));
        el.addEventListener("dragend", _cbSeatDragEnd);
        el.addEventListener("click", (e) => {
          if (!e.shiftKey) return;
          e.stopPropagation();
          window._cbToggleSeatSelection(seat.id);
        });
      }
      if (_cbMode === "assign") {
        el.addEventListener("dragover", (e) => _cbSeatAssignDragOver(e));
        el.addEventListener("dragleave", _cbSeatAssignDragLeave);
        el.addEventListener("drop", (e) => _cbSeatAssignDrop(e, seat.id));
        if (vm.studentId) {
          el.draggable = true;
          el.title = (seat.isLocked ? "\u{1F512} Locked \u2014 " : "") + "Drag to move/swap, or drop on the sidebar to unseat " + (vm.studentName || "");
          el.addEventListener("dragstart", (e) => _cbSeatOccupantDragStart(e, seat.id, vm.studentId));
          el.addEventListener("dragend", _cbSeatOccupantDragEnd);
          el.addEventListener("click", (e) => {
            if (e.target.closest(".cb-lock-btn")) return;
            _cbUnassign(seat.id);
          });
        }
      }
      canvas.appendChild(el);
    });
    const empty = document.getElementById("cb-empty");
    if (empty) {
      empty.style.display = _cbLocalSeats.length || _cbLocalProps.length ? "none" : "flex";
    }
  }
  function _cbRepaintSeats2() {
    if (!_cbLayoutId || !_cbMounted) return;
    const seatingMap = ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId);
    const mapBySeatId = Object.fromEntries(seatingMap.map((s) => [s.seatId, s]));
    document.querySelectorAll(".cb-seat").forEach((el) => {
      const seatId = el.dataset.seatId;
      const vm = mapBySeatId[seatId];
      if (!vm) return;
      const col = vm.color || ClassroomService.STATUS_COLORS["_empty"];
      el.style.background = col.bg;
      el.style.borderColor = vm.isLocked ? "#ffb95f" : col.border;
      const statusEl = el.querySelector(".cb-seat-status");
      if (statusEl) {
        statusEl.textContent = vm.attendanceStatus || (vm.studentId ? "\u2014" : "");
        statusEl.style.color = col.border;
      }
    });
    if (_cbMode === "assign") _cbRenderSidebar2();
  }
  function _cbRenderSidebar2() {
    const sidebar = document.getElementById("cb-sidebar");
    if (!sidebar) return;
    if (_cbMode === "build") {
      sidebar.innerHTML = `
      <div class="cb-sidebar-header">\u{1F6E0} Room Elements</div>
      <div class="cb-palette">
        <div class="cb-palette-title">Seats</div>
        <button class="cb-add-seat-btn" onclick="window._cbAddSeat()">\uFF0B Add Seat</button>
        <div class="cb-palette-title" style="margin-top:12px">Props</div>
        ${CB_PROP_TYPES.map((pt) => `
          <div class="cb-palette-item" onclick="window._cbAddProp('${pt.type}')">
            <span style="font-size:20px">${pt.emoji}</span>${pt.label}
          </div>
        `).join("")}
        <div class="cb-palette-title" style="margin-top:16px">Tips</div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.6;padding:4px 0">
          \u2022 Drag seats anywhere on the canvas<br>
          \u2022 Click \u21BB to rotate a seat 90\xB0<br>
          \u2022 Click \u2715 to remove a seat<br>
          \u2022 Hit <b style="color:var(--primary)">Save Layout</b> when done
        </div>
      </div>
    `;
      return;
    }
    const state = AppStore.getState();
    const students = (state.students || []).filter((s) => (s.classId || "default-class") === _cbClassId);
    const assigns = (state.seatAssignments || []).filter((a) => a.layoutId === _cbLayoutId);
    const assignedSet = new Set(assigns.map((a) => a.studentId));
    const logs = (state.attendanceLogs || []).filter(
      (l) => l.classId === _cbClassId && l.logDate === (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    );
    const logByStudent = Object.fromEntries(logs.map((l) => [l.studentId, l]));
    const unassigned = students.filter((s) => !assignedSet.has(s.id));
    const assigned = students.filter((s) => assignedSet.has(s.id));
    sidebar.innerHTML = `
    <div class="cb-sidebar-header">\u{1F465} Students
      <span style="font-size:10px;color:var(--text-muted);font-weight:600;margin-left:6px">
        ${unassigned.length} unseated
      </span>
    </div>
    <div class="cb-sidebar-list">
      <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
        color:var(--text-muted);margin-bottom:8px;padding:0 2px">Unassigned Pool</div>
      <div class="cb-pool-zone" id="cb-pool-zone">
        ${unassigned.length ? unassigned.map((s) => _cbStudentChip(s, false, logByStudent[s.id])).join("") : `<div style="font-size:12px;color:var(--text-muted);padding:8px 2px">All students are seated \u2705<br>Drag a seated student here to unseat them.</div>`}
      </div>
      ${assigned.length ? `
        <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
          color:var(--text-muted);margin:14px 0 8px;padding:0 2px">Assigned</div>
        ${assigned.map((s) => _cbStudentChip(s, true, logByStudent[s.id])).join("")}
      ` : ""}
    </div>
    <div class="cb-auto-bar">
      <select id="cb-auto-strategy" onchange="window._cbSetAutoStrategy(this.value)">
        <option value="alphabetical" ${_cbAutoStrategy === "alphabetical" ? "selected" : ""}>Alphabetical</option>
        <option value="random" ${_cbAutoStrategy === "random" ? "selected" : ""}>Random</option>
      </select>
      <button id="cb-auto-btn" class="btn btn-primary btn-sm" onclick="window._cbRunAutoAllocate()"
        ${!unassigned.length ? "disabled" : ""} title="Fills empty, unlocked seats only \u2014 never touches locked seats or already-seated students">
        \u26A1 Auto-Fill
      </button>
    </div>
  `;
    sidebar.querySelectorAll('.cb-student-chip[draggable="true"]').forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        _cbSeatOccupantDragStart(e, null, chip.dataset.studentId);
      });
      chip.addEventListener("dragend", (e) => {
        _cbSeatOccupantDragEnd(e);
      });
    });
    const poolZone = document.getElementById("cb-pool-zone");
    if (poolZone) {
      poolZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        poolZone.classList.add("drag-over");
      });
      poolZone.addEventListener("dragleave", () => poolZone.classList.remove("drag-over"));
      poolZone.addEventListener("drop", async (e) => {
        e.preventDefault();
        poolZone.classList.remove("drag-over");
        if (!_cbDragStudentId || !_cbLayoutId) return;
        const result = await ClassroomService.manualMoveStudent(_cbDragStudentId, null, _cbLayoutId);
        if (!result.ok) {
          toast("\u274C " + result.error, "#ffb4ab");
          return;
        }
        toast("\u2705 Returned to unassigned pool", "#d0bcff");
      });
    }
  }
  function _cbStudentChip(student, isAssigned, log) {
    const statusText = log ? log.status : isAssigned ? "\u2014" : "Not yet scanned";
    const chipColor = isAssigned ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.04)";
    return `
    <div class="cb-student-chip ${isAssigned ? "assigned" : ""}"
      draggable="${isAssigned ? "false" : "true"}"
      data-student-id="${_esc(student.id)}"
      title="${isAssigned ? "Already seated \u2014 drag them off their seat on the canvas to unseat" : "Drag to a seat"}">
      <div class="cb-chip-avatar" style="background:${_cssColor(student.color)}">${_esc(student.init || "?")}</div>
      <div class="cb-chip-info">
        <div class="cb-chip-name">${_esc(student.name || student.displayName || student.id)}</div>
        <div class="cb-chip-status">${statusText}</div>
      </div>
    </div>
  `;
  }
  function _cbRenderWizard2() {
    const root = document.getElementById("cb-modal-root");
    if (!root) return;
    if (!_cbWizardOpen) {
      root.innerHTML = "";
      return;
    }
    const lockedCount = _cbLocalSeats.filter((s) => s.isLocked).length;
    const activeShapeMeta = CB_SHAPE_TYPES.find((s) => s.shape === _cbWizardShape);
    root.innerHTML = `
    <div class="cb-modal-backdrop" onclick="if(event.target===this) window._cbCloseBlueprintWizard()">
      <div class="cb-modal">
        <div class="cb-modal-title">\u{1F4D0} Generate Room Blueprint</div>
        <div class="cb-modal-sub">Pick a room shape and dimensions \u2014 seats drop onto the canvas instantly.</div>

        <div class="cb-shape-grid">
          ${CB_SHAPE_TYPES.map((st) => `
            <div class="cb-shape-btn ${st.shape === _cbWizardShape ? "active" : ""}" onclick="window._cbSetWizardShape('${st.shape}')">
              <span class="ic">${st.emoji}</span>
              <span class="lb">${st.label}</span>
            </div>
          `).join("")}
        </div>

        <div class="cb-field-row">
          <div class="cb-field">
            <label>${_esc(activeShapeMeta.rowsLabel)}</label>
            <input type="number" id="cb-wiz-rows" class="cb-class-select" min="1" max="20" value="${_cbWizardRows}">
          </div>
          <div class="cb-field">
            <label>${_esc(activeShapeMeta.colsLabel)}</label>
            <input type="number" id="cb-wiz-cols" class="cb-class-select" min="1" max="20" value="${_cbWizardCols}">
          </div>
        </div>
        <div class="cb-field-row">
          <div class="cb-field">
            <label>Spacing (px)</label>
            <input type="number" id="cb-wiz-spacing" class="cb-class-select" min="40" max="200" step="10" value="${_cbWizardSpacing}">
          </div>
        </div>

        ${_cbWizardShape === "grid" ? `
          <div class="cb-field-row">
            <div class="cb-field">
              <label>Room Layout Preset</label>
              <select id="cb-wiz-preset" class="cb-class-select" onchange="window._cbSetWizardPreset(this.value)">
                ${CB_WALKWAY_PRESETS.map((p) => `
                  <option value="${p.preset}" ${p.preset === _cbWizardPreset ? "selected" : ""}>${_esc(p.label)}</option>
                `).join("")}
              </select>
            </div>
          </div>
          <div class="cb-modal-hint" style="margin-top:-6px">
            ${_esc(CB_WALKWAY_PRESETS.find((p) => p.preset === _cbWizardPreset).hint)}
          </div>
        ` : ""}

        ${lockedCount > 0 ? `
          <div class="cb-modal-hint">
            \u{1F512} ${lockedCount} locked seat${lockedCount !== 1 ? "s" : ""} in this layout will be preserved exactly as-is \u2014
            only the unlocked seats will be regenerated.
          </div>
        ` : `
          <div class="cb-modal-hint">This replaces all current (unlocked) seats on this layout with the new arrangement.</div>
        `}

        <div class="cb-modal-actions">
          <button class="btn btn-ghost btn-sm" onclick="window._cbCloseBlueprintWizard()">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="window._cbSubmitBlueprintWizard()">\u26A1 Generate</button>
        </div>
      </div>
    </div>
  `;
  }
  window._cbRenderCanvas = _cbRenderCanvas2;
  window._cbRenderShell = _cbRenderShell2;
  window._cbRepaintSeats = _cbRepaintSeats2;
  window._cbRenderSidebar = _cbRenderSidebar2;
  window._cbScaleCanvas = _cbScaleCanvas2;
  window._cbRenderWizard = _cbRenderWizard2;

  // build/bridges/classroom-builder-render.bridge.js
  window._cbRenderShell = _cbRenderShell2;
  window._cbScaleCanvas = _cbScaleCanvas2;
  window._cbRenderCanvas = _cbRenderCanvas2;
  window._cbRepaintSeats = _cbRepaintSeats2;
  window._cbRenderSidebar = _cbRenderSidebar2;
  window._cbStudentChip = _cbStudentChip;
  window._cbRenderWizard = _cbRenderWizard2;
})();
