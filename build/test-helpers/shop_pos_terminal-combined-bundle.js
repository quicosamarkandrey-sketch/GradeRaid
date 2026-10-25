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
  function closeModalForce() {
    document.getElementById("modal-overlay").style.display = "none";
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
  function todayStr() {
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }
  function nowStr() {
    return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
  }
  function isoDate() {
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  }

  // src/modules/shop/shop_orders.js
  var ordStatusPill = function(status) {
    const map = {
      pending: '<span class="badge-pill ord-status-pending">\u23F3 Pending</span>',
      ready: '<span class="badge-pill ord-status-ready">\u2705 Ready</span>',
      claimed: '<span class="badge-pill ord-status-claimed">\u{1F381} Claimed</span>',
      cancelled: '<span class="badge-pill ord-status-cancelled">\u274C Cancelled</span>'
    };
    return map[status] || `<span class="badge-pill bp-gray">${_esc(status)}</span>`;
  };
  var ordUpdateSidebarBadge = function() {
    const btn = document.getElementById("nav-s-orders");
    if (!btn) return;
    const active = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.studentId === currentUser?.id && (o.status === "pending" || o.status === "ready"));
    const old = btn.querySelector(".ord-nav-badge");
    if (old) old.remove();
    if (active.length > 0) {
      const badge = document.createElement("span");
      badge.className = "ord-nav-badge";
      badge.textContent = active.length > 99 ? "99+" : String(active.length);
      badge.style.cssText = "margin-left:auto;background:rgba(255,185,95,0.2);border:1px solid rgba(255,185,95,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--tertiary);font-family:var(--fh)";
      btn.appendChild(badge);
    }
  };
  AppStore.subscribe("shop-orders-boot-badge", function(state, event) {
    if (event.type !== "session:booted") return;
    if (currentRole === "student") setTimeout(ordUpdateSidebarBadge, 55);
  });
  console.log("[EduQuest] shop/orders.js loaded \u2014 renderStudentOrders, ord* helpers, ordUpdateSidebarBadge registered.");

  // src/modules/shop/shop_store.js
  var posGenCode = function(existingOrders) {
    const orders = existingOrders || AppStore.getSlice((s) => s.orders) || [];
    const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const rA = () => alpha[Math.floor(Math.random() * alpha.length)];
    const rN = () => Math.floor(Math.random() * 10);
    let code, tries = 0;
    do {
      code = `${rA()}${rA()}${rA()}-${rN()}${rN()}${rN()}-${rA()}${rA()}${rA()}`;
      tries++;
    } while (tries < 100 && orders.some((o) => o.claimCode === code && o.status === "pending"));
    return code;
  };
  console.log("[EduQuest] shop/store.js loaded \u2014 renderStudentStore, cart engine, posGenCode, posShowClaimCode registered.");

  // src/modules/shop/shop_pos_terminal.js
  (function injectPosCSS() {
    if (document.getElementById("pos-terminal-css")) return;
    const style = document.createElement("style");
    style.id = "pos-terminal-css";
    style.textContent = `
.ord-status-pending{background:rgba(255,185,95,.14);color:#ffb95f;border:1px solid rgba(255,185,95,.3)}
.ord-status-ready{background:rgba(78,222,163,.12);color:#4edea3;border:1px solid rgba(78,222,163,.28)}
.ord-status-claimed{background:rgba(208,188,255,.12);color:#d0bcff;border:1px solid rgba(208,188,255,.25)}
.ord-status-cancelled{background:rgba(255,180,171,.1);color:#ffb4ab;border:1px solid rgba(255,180,171,.22)}
.ord-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:14px;transition:all .2s;margin-bottom:8px}
.ord-row:hover{border-color:rgba(208,188,255,.25);background:rgba(35,31,56,.95)}
.ord-emoji{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border)}
.ord-info{flex:1;min-width:0}
.ord-name{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.ord-meta{font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ord-code{font-family:var(--fm);font-size:13px;font-weight:900;color:var(--secondary);letter-spacing:.12em;margin-top:5px}
.ord-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center}
.pos-terminal{background:rgba(26,20,56,.95);border:1px solid rgba(78,222,163,.2);border-radius:20px;padding:24px;margin-bottom:20px}
.pos-search-bar{display:flex;gap:10px;margin-bottom:20px}
.pos-search-input{flex:1;background:rgba(35,31,56,.9);border:2px solid rgba(78,222,163,.3);border-radius:12px;padding:12px 16px;color:var(--text);font-family:var(--fm);font-size:18px;font-weight:900;letter-spacing:.18em;outline:none;text-transform:uppercase;transition:border-color .2s}
.pos-search-input:focus{border-color:rgba(78,222,163,.7);box-shadow:0 0 0 4px rgba(78,222,163,.1)}
.pos-search-input::placeholder{font-size:13px;letter-spacing:.04em;text-transform:none;font-family:var(--fb);font-weight:400;color:var(--text-muted)}
.pos-result-card{background:rgba(35,31,56,.9);border:2px solid rgba(78,222,163,.35);border-radius:16px;padding:20px;animation:fadeIn .25s ease}
.pos-result-found{border-color:rgba(78,222,163,.5);box-shadow:0 0 24px rgba(78,222,163,.12)}
.pos-result-error{border-color:rgba(255,180,171,.4);box-shadow:0 0 24px rgba(255,180,171,.1)}
.pos-result-claimed{border-color:rgba(208,188,255,.35);box-shadow:0 0 16px rgba(208,188,255,.1)}
.pos-order-main{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.pos-order-emoji{font-size:48px;line-height:1;flex-shrink:0}
.pos-student-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:10px;font-family:var(--fh);font-size:13px;font-weight:700;color:var(--on-surface)}
.pos-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0}
.pos-stat-card{background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:14px;padding:18px;text-align:center}
.pos-stat-val{font-family:var(--fh);font-size:26px;font-weight:900;margin-bottom:4px;line-height:1}
.pos-stat-lbl{font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.pos-queue-row{display:grid;grid-template-columns:auto 1fr auto auto auto;gap:12px;align-items:center;padding:12px 14px;background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;margin-bottom:7px;transition:all .2s}
.pos-queue-row:hover{border-color:rgba(78,222,163,.25);background:rgba(35,31,56,.95)}
.pos-tab{display:flex;align-items:center;gap:8px;padding:10px 18px;font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.pos-tab:hover{color:var(--on-surface)}
.pos-tab.active{color:var(--secondary);border-bottom-color:var(--secondary-dark)}
.sord-tab{display:flex;align-items:center;gap:8px;padding:11px 20px;font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.sord-tab:hover{color:var(--on-surface)}
.sord-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.item-rank-chip{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:12px;margin-bottom:7px;transition:all .2s}
.item-rank-chip:hover{border-color:rgba(208,188,255,.25)}
.item-rank-num{font-family:var(--fm);font-size:11px;font-weight:900;color:var(--text-muted);width:20px;text-align:right;flex-shrink:0}
.aord-filter-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
.pos-pay-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:520px;overflow-y:auto;padding-right:4px}
.pos-pay-tile{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;padding:12px 10px;text-align:center;cursor:pointer;transition:all .15s;position:relative}
.pos-pay-tile:hover{border-color:rgba(78,222,163,.35);transform:translateY(-2px)}
.pos-pay-tile.out{opacity:.4;cursor:not-allowed;pointer-events:none}
.pos-pay-tile-emoji{font-size:26px;margin-bottom:6px}
.pos-pay-tile-name{font-family:var(--fh);font-size:11px;font-weight:800;color:var(--on-surface);line-height:1.25;margin-bottom:4px;min-height:28px;display:flex;align-items:center;justify-content:center}
.pos-pay-tile-cost{font-family:var(--fh);font-size:13px;font-weight:900;color:var(--tertiary)}
.pos-pay-tile-stock{font-size:9px;color:var(--text-muted);margin-top:2px}
.pos-pay-cart-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.pos-pay-waiting{text-align:center;padding:20px 10px;background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.22);border-radius:14px}
.pos-pay-waiting-pulse{font-size:38px;animation:posPayPulse 1.3s ease-in-out infinite}
@keyframes posPayPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.15);opacity:.7}}
.pos-pay-identified{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:4px}
.pos-pay-declined{background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.25);border-radius:14px;padding:16px}
.pos-pay-declined-row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--on-surface)}
.pos-pay-success{background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.25);border-radius:14px;padding:18px;text-align:center}
.pos-pay-manual-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s}
.pos-pay-manual-row:hover{border-color:rgba(78,222,163,.3);background:rgba(35,31,56,1)}
`;
    document.head.appendChild(style);
  })();
  AppStore.ready.then(function() {
    if (!AppStore.getSlice((s) => s.orders)) {
      AppStore.updateState((draft) => {
        draft.orders = [];
      }, { type: "shop:orders-initialized" });
    }
  });
  var renderPOS = function() {
    _posPayCart = {};
    _posPayManualStudentId = null;
    if (typeof window.unmountPosPayCapture === "function") window.unmountPosPayCapture();
    const orders = AppStore.getSlice((s) => s.orders) || [];
    const pending = orders.filter((o) => o.status === "pending");
    const claimed = orders.filter((o) => o.status === "claimed");
    const cancelled = orders.filter((o) => o.status === "cancelled");
    document.getElementById("a-pos").innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.16em;margin-bottom:6px">TEACHER // REWARD_POS</div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--on-surface)">\u{1F3EA} Reward POS</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">Verify and distribute physical classroom rewards</div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--tertiary)">${pending.length}</div><div class="pos-stat-lbl">Pending</div></div>
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--secondary)">${claimed.length}</div><div class="pos-stat-lbl">Claimed</div></div>
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--primary)">${orders.length}</div><div class="pos-stat-lbl">Total</div></div>
    </div>
  </div>

  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px">
    <button class="pos-tab active" id="postab-scanner"   onclick="posSwitchTab('scanner')"><span class="material-symbols-outlined" style="font-size:16px">qr_code_scanner</span> Claim Code Scanner</button>
    <button class="pos-tab"        id="postab-pay"       onclick="posSwitchTab('pay')"><span class="material-symbols-outlined" style="font-size:16px">contactless</span> Scan &amp; Pay</button>
    <button class="pos-tab"        id="postab-queue"     onclick="posSwitchTab('queue')"><span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Pending Queue ${pending.length > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${pending.length}</span>` : ""}</button>
    <button class="pos-tab"        id="postab-history"   onclick="posSwitchTab('history')"><span class="material-symbols-outlined" style="font-size:16px">history</span> Redemption Log</button>
    <button class="pos-tab"        id="postab-analytics" onclick="posSwitchTab('analytics')"><span class="material-symbols-outlined" style="font-size:16px">bar_chart</span> Analytics</button>
  </div>

  <div id="pos-panel-scanner">
    <div class="pos-terminal">
      <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--secondary);display:inline-block;box-shadow:0 0 8px rgba(78,222,163,.7);animation:wbLiveDot 1.5s ease-in-out infinite"></span>
        POS TERMINAL \u2014 ENTER CLAIM CODE
      </div>
      <div class="pos-search-bar">
        <input type="text" id="pos-code-input" class="pos-search-input" placeholder="Enter claim code (e.g. ABC-123-XYZ)"
          maxlength="13"
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')"
          onkeydown="if(event.key==='Enter')posLookupCode()"
          autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false">
        <button class="btn btn-success" style="padding:12px 20px;font-size:14px" onclick="posLookupCode()">
          <span class="material-symbols-outlined" style="font-size:18px">search</span> Lookup
        </button>
      </div>
      <div id="pos-lookup-result"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:-12px;margin-bottom:12px">
      Press <kbd style="background:rgba(255,255,255,.08);border:1px solid var(--border2);border-radius:4px;padding:1px 5px;font-family:var(--fm);font-size:10px">Enter</kbd> to lookup \xB7 Format: <span style="font-family:var(--fm);color:var(--secondary)">XXX-NNN-XXX</span>
    </div>
  </div>

  <div id="pos-panel-pay" style="display:none">
    <input type="text" id="pos-pay-capture-input" autocomplete="off" inputmode="none"
      style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"
      oninput="_posPayOnCaptureInput()"
      onkeydown="if(event.key==='Enter'){event.preventDefault();_posPayFinalizeCapture();}">
    <div style="display:grid;grid-template-columns:1.3fr .9fr;gap:20px;align-items:start" id="pos-pay-layout">
      <div class="pos-terminal" style="margin-bottom:0">
        <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px">\u{1F3EA} RING UP SALE \u2014 TAP ITEMS TO ADD</div>
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          <input type="text" id="pos-pay-search" placeholder="Search items\u2026" oninput="_posPayRenderGrid()"
            style="flex:1;min-width:160px;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--text);outline:none">
          <select id="pos-pay-cat" onchange="_posPayRenderGrid()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 10px;font-size:12px;color:var(--text);cursor:pointer">
            <option value="all">All Categories</option>
            <option value="food">\u{1F354} Food</option><option value="supplies">\u{1F4E6} Supplies</option>
            <option value="privilege">\u2B50 Privilege</option><option value="mystery">\u2753 Mystery</option>
          </select>
        </div>
        <div id="pos-pay-grid" class="pos-pay-grid"></div>
      </div>
      <div class="pos-terminal" style="margin-bottom:0">
        <div id="pos-pay-cart-box"></div>
      </div>
    </div>
  </div>

  <div id="pos-panel-queue" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="section-header" style="margin-bottom:0">
          <span class="material-symbols-outlined" style="color:var(--tertiary)">pending_actions</span>
          <h2>Pending Orders</h2>
          <span class="badge-pill bp-gold">${pending.length} orders</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="pos-queue-search" placeholder="Filter by student or item\u2026" oninput="posFilterQueue()"
          style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--text);font-family:var(--fb);outline:none;min-width:220px">
        <select id="pos-queue-cat" onchange="posFilterQueue()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option>
          <option value="food">\u{1F354} Food</option><option value="supplies">\u{1F4E6} Supplies</option>
          <option value="privilege">\u2B50 Privilege</option><option value="mystery">\u2753 Mystery</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="renderPOS();posSwitchTab('queue')">
          <span class="material-symbols-outlined" style="font-size:14px">refresh</span>
        </button>
      </div>
    </div>
    <div id="pos-queue-list"></div>
  </div>

  <div id="pos-panel-history" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div class="section-header" style="margin-bottom:0">
        <span class="material-symbols-outlined" style="color:var(--secondary)">receipt_long</span>
        <h2>Redemption History</h2>
        <span class="badge-pill bp-green">${claimed.length} claimed</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="pos-hist-search" placeholder="Filter by student or item\u2026" oninput="posFilterHistory()"
          style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--text);font-family:var(--fb);outline:none;min-width:220px">
        <select id="pos-hist-filter" onchange="posFilterHistory()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="claimed">Claimed</option><option value="cancelled">Cancelled</option><option value="all">All Completed</option>
        </select>
      </div>
    </div>
    <div id="pos-hist-list"></div>
  </div>

  <div id="pos-panel-analytics" style="display:none">${_posAnalyticsHTML()}</div>`;
    posFilterQueue();
    posFilterHistory();
    setTimeout(() => document.getElementById("pos-code-input")?.focus(), 120);
  };
  var posSwitchTab = function(tab) {
    ["scanner", "pay", "queue", "history", "analytics"].forEach((t) => {
      const btn = document.getElementById("postab-" + t);
      const panel = document.getElementById("pos-panel-" + t);
      if (btn) btn.classList.toggle("active", t === tab);
      if (panel) panel.style.display = t === tab ? "block" : "none";
    });
    if (tab !== "pay" && typeof window.unmountPosPayCapture === "function") window.unmountPosPayCapture();
    if (tab === "pay") _posPayRenderPanel();
    if (tab === "queue") posFilterQueue();
    if (tab === "history") posFilterHistory();
    if (tab === "analytics") {
      const ap = document.getElementById("pos-panel-analytics");
      if (ap) ap.innerHTML = _posAnalyticsHTML();
    }
    if (tab === "scanner") setTimeout(() => document.getElementById("pos-code-input")?.focus(), 80);
  };
  var posLookupCode = function() {
    const raw = (document.getElementById("pos-code-input")?.value || "").trim().toUpperCase();
    const result = document.getElementById("pos-lookup-result");
    if (!result) return;
    if (!raw) {
      result.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;font-size:13px">Enter a claim code above to look up an order.</div>';
      return;
    }
    const order = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.claimCode === raw);
    if (!order) {
      result.innerHTML = `<div class="pos-result-card pos-result-error"><div style="display:flex;align-items:center;gap:14px"><div style="font-size:36px">\u274C</div><div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:#ffb4ab;margin-bottom:4px">Code Not Found</div><div style="font-size:13px;color:var(--text-muted)">No order matches <span style="font-family:var(--fm);color:#ffb4ab">${_esc(raw)}</span>. Check the code and try again.</div></div></div></div>`;
      return;
    }
    if (order.status === "claimed") {
      result.innerHTML = `<div class="pos-result-card pos-result-claimed"><div style="display:flex;align-items:flex-start;gap:16px"><div style="font-size:44px;flex-shrink:0">${order.emoji || "\u{1F381}"}</div><div style="flex:1"><div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#d0bcff;margin-bottom:6px">${_esc(order.itemName)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${ordStatusPill("claimed")}<span class="pos-student-chip"><span class="pos-av" style="background:${_cssColor(order.studentColor)}22;border:1px solid ${_cssColor(order.studentColor)}44;color:${_cssColor(order.studentColor)}">${_esc(order.studentInit || "?")}</span>${_esc(order.studentName)}</span></div><div style="font-size:12px;color:var(--text-muted)">Already claimed on ${order.claimedAt ? new Date(order.claimedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Unknown"} by ${_esc(order.claimedBy || "Teacher")}</div></div></div><div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><div style="font-size:12px;color:var(--text-muted);text-align:center">\u26A0\uFE0F This reward has already been distributed. Duplicate claims are blocked.</div></div></div>`;
      return;
    }
    if (order.status === "cancelled") {
      result.innerHTML = `<div class="pos-result-card pos-result-error"><div style="display:flex;align-items:center;gap:14px"><div style="font-size:36px;filter:grayscale(1)">${order.emoji || "\u{1F381}"}</div><div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:#ffb4ab;margin-bottom:4px">${_esc(order.itemName)}</div><div style="font-size:13px;color:var(--text-muted)">This order was cancelled.${order.cancelReason ? " Reason: " + _esc(order.cancelReason) : ""}</div></div></div></div>`;
      return;
    }
    result.innerHTML = `<div class="pos-result-card pos-result-found">
    <div class="pos-order-main">
      <div class="pos-order-emoji">${order.emoji || "\u{1F381}"}</div>
      <div style="flex:1">
        <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:6px">${_esc(order.itemName)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${ordStatusPill(order.status)}<span class="pos-student-chip"><span class="pos-av" style="background:${_cssColor(order.studentColor)}22;border:1px solid ${_cssColor(order.studentColor)}44;color:${_cssColor(order.studentColor)}">${_esc(order.studentInit || "?")}</span>${_esc(order.studentName)}</span></div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);flex-wrap:wrap">
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">monetization_on</span> ${(order.cost || 0).toLocaleString()} coins</span>
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">calendar_today</span> ${_esc(order.createdDateStr || "")}</span>
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">tag</span> ${_esc(order.orderId)}</span>
        </div>
      </div>
    </div>
    <div style="background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px">CLAIM CODE VERIFIED</div>
      <div style="font-family:var(--fm);font-size:28px;font-weight:900;color:var(--secondary);letter-spacing:.2em;text-shadow:0 0 16px rgba(78,222,163,.4)">${_esc(order.claimCode)}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-success" style="flex:1" onclick="posConfirmClaim('${order.orderId}')"><span class="material-symbols-outlined" style="font-size:16px">check_circle</span> Mark as Claimed</button>
      <button class="btn btn-danger" onclick="posCancelOrderPrompt('${order.orderId}')"><span class="material-symbols-outlined" style="font-size:16px">cancel</span> Cancel</button>
    </div>
  </div>`;
  };
  var posConfirmClaim = function(orderId) {
    const order = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!order) {
      toast("Order not found.", "#ffb4ab");
      return;
    }
    if (order.status === "claimed") {
      toast("\u26A0\uFE0F Already claimed!", "#ffb4ab");
      return;
    }
    if (order.status === "cancelled") {
      toast("\u26A0\uFE0F Order was cancelled.", "#ffb4ab");
      return;
    }
    showModal(`<div style="text-align:center">
    <div style="font-size:52px;margin-bottom:12px">${order.emoji || "\u{1F381}"}</div>
    <div class="modal-h2" style="text-align:center">Confirm Distribution</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">You are about to mark this reward as physically given to the student.</div>
    <div style="background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.22);border-radius:12px;padding:16px;margin-bottom:20px">
      <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${_esc(order.itemName)}</div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-muted)">Student</span><span style="font-weight:700">${_esc(order.studentName)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-muted)">Claim Code</span><span style="font-family:var(--fm);color:var(--secondary)">${_esc(order.claimCode)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-muted)">Cost</span><span style="color:var(--tertiary);font-weight:700">${(order.cost || 0).toLocaleString()} \u{1FA99}</span></div>
    </div>
    <div style="background:rgba(255,185,95,.06);border:1px solid rgba(255,185,95,.18);border-radius:10px;padding:10px;margin-bottom:20px;font-size:12px;color:var(--text-muted)">\u26A0\uFE0F This cannot be undone. The code will be invalidated after claiming.</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-success" style="flex:1" onclick="posExecuteClaim('${orderId}')"><span class="material-symbols-outlined" style="font-size:15px">check_circle</span> Confirm & Give Reward</button>
    </div>
  </div>`, "sm");
  };
  var posExecuteClaim = function(orderId) {
    const existing = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!existing || existing.status === "claimed") {
      closeModalForce();
      toast("\u26A0\uFE0F Already claimed.", "#ffb4ab");
      return;
    }
    const claimedBy = (AppStore.getSlice((s) => s.admin) || {}).name || currentUser?.name || "Teacher";
    AppStore.updateState((draft) => {
      const order = (draft.orders || []).find((o) => o.orderId === orderId);
      if (!order || order.status === "claimed") return;
      order.status = "claimed";
      order.claimedAt = Date.now();
      order.claimedBy = claimedBy;
    }, { type: "shop:order-claimed", payload: { orderId } });
    closeModalForce();
    toast(`\u2705 ${existing.emoji} "${_esc(existing.itemName)}" claimed by ${_esc(existing.studentName)}!`, "#4edea3");
    const input = document.getElementById("pos-code-input");
    if (input) input.value = "";
    const resultEl = document.getElementById("pos-lookup-result");
    if (resultEl) resultEl.innerHTML = `<div style="text-align:center;padding:20px;background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.2);border-radius:14px;animation:fadeIn .3s ease"><div style="font-size:40px;margin-bottom:8px">\u2705</div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary);margin-bottom:4px">Reward Distributed!</div><div style="font-size:13px;color:var(--text-muted)">${_esc(existing.emoji)} ${_esc(existing.itemName)} \u2192 ${_esc(existing.studentName)}</div></div>`;
    const tab = document.getElementById("postab-queue");
    if (tab) {
      const pCount = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.status === "pending").length;
      tab.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Pending Queue${pCount > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${pCount}</span>` : ""}`;
    }
  };
  var posCancelOrderPrompt = function(orderId) {
    const order = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!order) return;
    showModal(`<div>
    <div class="modal-h2">Cancel Order?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Cancel <b style="color:var(--on-surface)">${_esc(order.itemName)}</b> for <b style="color:var(--on-surface)">${_esc(order.studentName)}</b>?</div>
    <div style="background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;color:#ffb4ab;margin-bottom:10px">\u26A0\uFE0F The student's coins will NOT be automatically refunded. Refund manually if needed.</div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Reason (optional)</label><input type="text" id="pos-cancel-reason" placeholder="e.g. Out of stock, item unavailable" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Order</button>
      <button class="btn btn-danger" style="flex:1" onclick="posExecuteCancel('${orderId}')"><span class="material-symbols-outlined" style="font-size:14px">cancel</span> Cancel Order</button>
    </div>
  </div>`, "sm");
  };
  var posExecuteCancel = function(orderId) {
    const existing = (AppStore.getSlice((s) => s.orders) || []).find((o) => o.orderId === orderId);
    if (!existing) {
      closeModalForce();
      return;
    }
    const reason = (document.getElementById("pos-cancel-reason")?.value || "").trim();
    const cancelledBy = (AppStore.getSlice((s) => s.admin) || {}).name || currentUser?.name || "Teacher";
    AppStore.updateState((draft) => {
      const order = (draft.orders || []).find((o) => o.orderId === orderId);
      if (!order) return;
      order.status = "cancelled";
      order.cancelledAt = Date.now();
      order.cancelReason = reason || "Cancelled by teacher";
      order.cancelledBy = cancelledBy;
    }, { type: "shop:order-cancelled", payload: { orderId } });
    closeModalForce();
    toast(`\u{1F6AB} Order for "${_esc(existing.itemName)}" cancelled.`, "#ffb4ab");
    renderPOS();
    posSwitchTab("queue");
  };
  var _posPayCart = {};
  var _posPayManualStudentId = null;
  var _posPayScanArmed = false;
  var _posPayCaptureFocusInterval = null;
  var _posPayCaptureTimer = null;
  var _posPayLastChargedTag = null;
  var _posPayLastChargeAt = 0;
  var _posPayBusy = false;
  function _posPayTotal() {
    return Object.values(_posPayCart).reduce((s, e) => s + e.item.cost * e.qty, 0);
  }
  function _posPayRenderPanel() {
    _posPayRenderGrid();
    _posPayRenderCart();
  }
  function _posPayRenderGrid() {
    const grid = document.getElementById("pos-pay-grid");
    if (!grid) return;
    const q = (document.getElementById("pos-pay-search")?.value || "").toLowerCase().trim();
    const cat = document.getElementById("pos-pay-cat")?.value || "all";
    let items = AppStore.getSlice((s) => s.store) || [];
    if (cat !== "all") items = items.filter((i) => i.cat === cat);
    if (q) items = items.filter((i) => (i.name || "").toLowerCase().includes(q));
    if (!items.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 10px;color:var(--text-muted);font-size:12px">No items match.</div>`;
      return;
    }
    grid.innerHTML = items.map((item) => {
      const out = item.stock === 0;
      const inCart = _posPayCart[item.id] ? _posPayCart[item.id].qty : 0;
      return `<div class="pos-pay-tile ${out ? "out" : ""}" onclick="posPayAddItem('${item.id}')" title="${out ? "Out of stock" : "Add to sale"}">
      <div class="pos-pay-tile-emoji">${item.emoji}</div>
      <div class="pos-pay-tile-name">${_esc(item.name)}</div>
      <div class="pos-pay-tile-cost">${item.cost.toLocaleString()} \u{1FA99}</div>
      <div class="pos-pay-tile-stock">${out ? "Out of stock" : `${item.stock} in stock`}${inCart ? ` \xB7 ${inCart} in sale` : ""}</div>
    </div>`;
    }).join("");
  }
  var posPayAddItem = function(id) {
    const item = (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === id);
    if (!item) return;
    if (item.stock === 0) {
      toast("\u274C Out of stock!", "#ffb4ab");
      return;
    }
    const cartQty = _posPayCart[id] ? _posPayCart[id].qty : 0;
    if (cartQty >= item.stock) {
      toast(`\u274C Only ${item.stock} in stock!`, "#ffb4ab");
      return;
    }
    if (!_posPayCart[id]) _posPayCart[id] = { item, qty: 0 };
    _posPayCart[id].qty++;
    _posPayCart[id].item = item;
    _posPayRenderGrid();
    _posPayRenderCart();
  };
  var posPayIncQty = function(id) {
    window.posPayAddItem(id);
  };
  var posPayDecQty = function(id) {
    if (!_posPayCart[id]) return;
    _posPayCart[id].qty--;
    if (_posPayCart[id].qty <= 0) delete _posPayCart[id];
    _posPayRenderGrid();
    _posPayRenderCart();
  };
  var posPayClearCart = function() {
    _posPayCart = {};
    _posPayManualStudentId = null;
    window.unmountPosPayCapture();
    _posPayRenderGrid();
    _posPayRenderCart();
  };
  function _posPayRenderCart() {
    const box = document.getElementById("pos-pay-cart-box");
    if (!box) return;
    const entries = Object.values(_posPayCart);
    const total = _posPayTotal();
    box.innerHTML = `
    <div class="section-header" style="margin-bottom:12px">
      <span class="material-symbols-outlined" style="color:var(--secondary)">shopping_cart</span>
      <h2>Current Sale</h2>
      ${entries.length ? `<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="posPayClearCart()">Clear</button>` : ""}
    </div>
    ${!entries.length ? `<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;border:2px dashed rgba(255,255,255,.07);border-radius:14px">\u{1F6CD}\uFE0F Tap items on the left to ring them up.</div>` : `<div style="max-height:230px;overflow-y:auto;margin-bottom:14px">
          ${entries.map((e) => `
          <div class="pos-pay-cart-row">
            <div style="font-size:20px">${e.item.emoji}</div>
            <div style="flex:1;min-width:0">
              <div style="font-family:var(--fh);font-size:12px;font-weight:800;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(e.item.name)}</div>
              <div style="font-size:11px;color:var(--tertiary)">${e.item.cost.toLocaleString()} \xD7 ${e.qty} = ${(e.item.cost * e.qty).toLocaleString()} \u{1FA99}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
              <button class="btn btn-ghost btn-xs" onclick="posPayDecQty('${e.item.id}')">\u2212</button>
              <span style="min-width:16px;text-align:center;font-size:12px;font-weight:700">${e.qty}</span>
              <button class="btn btn-ghost btn-xs" onclick="posPayIncQty('${e.item.id}')">+</button>
            </div>
          </div>`).join("")}
        </div>`}
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid var(--border);margin-bottom:4px">
      <span style="font-size:12px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">Total Due</span>
      <span style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--tertiary)">${total.toLocaleString()} \u{1FA99}</span>
    </div>
    <div id="pos-pay-status">${_posPayIdleStatusHTML(entries.length)}</div>
  `;
  }
  function _posPayIdleStatusHTML(count) {
    return `
  <button class="btn btn-success btn-block" style="padding:14px;font-size:14px" ${count ? "" : "disabled"} onclick="posPayArmScan()">
    <span class="material-symbols-outlined">contactless</span> Tap Card to Pay
  </button>
  <div style="text-align:center;margin:10px 0;font-size:11px;color:var(--text-muted)">or, if the card is lost/unregistered</div>
  <input type="text" id="pos-pay-manual-search" placeholder="Search student by name\u2026" oninput="posPaySearchStudent()" ${count ? "" : "disabled"}
    style="width:100%;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--text);outline:none">
  <div id="pos-pay-manual-results" style="margin-top:6px"></div>`;
  }
  function _posPayStartCapture() {
    if (_posPayCaptureFocusInterval) {
      clearInterval(_posPayCaptureFocusInterval);
      _posPayCaptureFocusInterval = null;
    }
    if (_posPayCaptureTimer) {
      clearTimeout(_posPayCaptureTimer);
      _posPayCaptureTimer = null;
    }
    const input = document.getElementById("pos-pay-capture-input");
    if (!input) return;
    input.value = "";
    input.focus();
    _posPayCaptureFocusInterval = setInterval(() => {
      const el = document.getElementById("pos-pay-capture-input");
      if (el && _posPayScanArmed && document.activeElement !== el) el.focus();
    }, 300);
  }
  var unmountPosPayCapture = function() {
    if (_posPayCaptureFocusInterval) {
      clearInterval(_posPayCaptureFocusInterval);
      _posPayCaptureFocusInterval = null;
    }
    if (_posPayCaptureTimer) {
      clearTimeout(_posPayCaptureTimer);
      _posPayCaptureTimer = null;
    }
    _posPayScanArmed = false;
  };
  var _posPayOnCaptureInput = function() {
    if (_posPayCaptureTimer) clearTimeout(_posPayCaptureTimer);
    _posPayCaptureTimer = setTimeout(window._posPayFinalizeCapture, 120);
  };
  var _posPayFinalizeCapture = function() {
    const input = document.getElementById("pos-pay-capture-input");
    if (!input) return;
    const tag = (input.value || "").trim();
    input.value = "";
    if (!tag || !_posPayScanArmed) return;
    _posPayHandleTag(tag);
  };
  var posPayArmScan = function() {
    if (!Object.keys(_posPayCart).length) {
      toast("Add items to the sale first.", "#ffb95f");
      return;
    }
    _posPayScanArmed = true;
    const status = document.getElementById("pos-pay-status");
    if (status) status.innerHTML = `
    <div class="pos-pay-waiting">
      <div class="pos-pay-waiting-pulse">\u{1F4B3}</div>
      <div style="font-family:var(--fh);font-size:14px;font-weight:800;color:var(--secondary);margin-top:10px">Waiting for card tap\u2026</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Have the student tap their card on the reader</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="posPayCancelScan()">Cancel</button>
    </div>`;
    _posPayStartCapture();
  };
  var posPayCancelScan = function() {
    window.unmountPosPayCapture();
    _posPayRenderCart();
  };
  var posPayEditSale = function() {
    window.unmountPosPayCapture();
    _posPayRenderCart();
  };
  function _posPayHandleTag(tag) {
    const card = (AppStore.getSlice((s) => s.rfidCards) || []).find((c) => c.tagId === tag && c.isActive);
    if (!card) {
      _posPayRenderScanError("Card not recognized \u2014 it isn't registered to any student.");
      return;
    }
    const now = Date.now();
    if (_posPayLastChargedTag === tag && now - _posPayLastChargeAt < 5e3) return;
    _posPayLastChargedTag = tag;
    _posPayLastChargeAt = now;
    window.unmountPosPayCapture();
    _posPayAttemptCharge(card.studentId, "scan");
  }
  function _posPayRenderScanError(msg) {
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    status.innerHTML = `
    <div style="text-align:center;padding:16px;background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.22);border-radius:14px">
      <div style="font-size:28px;margin-bottom:6px">\u{1F6AB}</div>
      <div style="font-size:12px;color:#ffb4ab;margin-bottom:12px">${_esc(msg)}</div>
      <button class="btn btn-ghost btn-sm" onclick="posPayArmScan()">Try Again</button>
    </div>`;
  }
  var posPaySearchStudent = function() {
    const q = (document.getElementById("pos-pay-manual-search")?.value || "").toLowerCase().trim();
    const box = document.getElementById("pos-pay-manual-results");
    if (!box) return;
    if (!q) {
      box.innerHTML = "";
      return;
    }
    const matches = (AppStore.getSlice((s) => s.students) || []).filter((s) => (s.name || "").toLowerCase().includes(q)).slice(0, 6);
    if (!matches.length) {
      box.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 2px">No students match "${_esc(q)}".</div>`;
      return;
    }
    box.innerHTML = matches.map((s) => `
    <div class="pos-pay-manual-row" onclick="posPaySelectStudent('${s.id}')">
      <span class="pos-av" style="background:${_cssColor(s.color)}22;border:1px solid ${_cssColor(s.color)}44;color:${_cssColor(s.color)}">${_esc(s.init || "?")}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--on-surface)">${_esc(s.name)}</div>
        <div style="font-size:10px;color:var(--text-muted)">${(s.coins || 0).toLocaleString()} \u{1FA99} balance</div>
      </div>
    </div>`).join("");
  };
  var posPaySelectStudent = function(id) {
    const student = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === id);
    if (!student) return;
    _posPayManualStudentId = id;
    const total = _posPayTotal();
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    status.innerHTML = `
    <div class="pos-pay-identified">
      <span class="pos-av" style="width:34px;height:34px;font-size:13px;background:${_cssColor(student.color)}22;border:1px solid ${_cssColor(student.color)}44;color:${_cssColor(student.color)}">${_esc(student.init || "?")}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(student.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Balance: ${(student.coins || 0).toLocaleString()} \u{1FA99}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="posPayEditSale()">Cancel</button>
      <button class="btn btn-success" style="flex:1" onclick="posPayManualCharge()">Confirm &amp; Charge ${total.toLocaleString()} \u{1FA99}</button>
    </div>`;
  };
  var posPayManualCharge = function() {
    if (!_posPayManualStudentId) return;
    _posPayAttemptCharge(_posPayManualStudentId, "manual");
  };
  function _posPayRenderProcessing(student) {
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    status.innerHTML = `
    <div class="pos-pay-identified">
      <span class="pos-av" style="width:34px;height:34px;font-size:13px;background:${_cssColor(student.color)}22;border:1px solid ${_cssColor(student.color)}44;color:${_cssColor(student.color)}">${_esc(student.init || "?")}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(student.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Balance: ${(student.coins || 0).toLocaleString()} \u{1FA99}</div>
      </div>
    </div>
    <div style="text-align:center;padding:14px 0;color:var(--text-muted);font-size:12px">\u23F3 Processing payment\u2026</div>`;
  }
  function _posPayRenderDeclined(student, total) {
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    const shortBy = Math.max(0, total - (student.coins || 0));
    status.innerHTML = `
    <div class="pos-pay-declined">
      <div style="font-size:34px;text-align:center">\u274C</div>
      <div style="font-family:var(--fh);font-size:15px;font-weight:900;color:#ffb4ab;text-align:center;margin:6px 0 2px">DECLINED</div>
      <div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:12px">Insufficient balance</div>
      <div class="pos-pay-declined-row">
        <span class="pos-av" style="background:${_cssColor(student.color)}22;border:1px solid ${_cssColor(student.color)}44;color:${_cssColor(student.color)}">${_esc(student.init || "?")}</span>
        ${_esc(student.name)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:10px"><span style="color:var(--text-muted)">Sale Total</span><span style="font-weight:700">${total.toLocaleString()} \u{1FA99}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px"><span style="color:var(--text-muted)">Student Balance</span><span style="font-weight:700">${(student.coins || 0).toLocaleString()} \u{1FA99}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,180,171,.2)"><span style="color:#ffb4ab;font-weight:700">Short By</span><span style="color:#ffb4ab;font-weight:900">${shortBy.toLocaleString()} \u{1FA99}</span></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-ghost" style="flex:1" onclick="posPayEditSale()">\u270F\uFE0F Edit Sale</button>
        <button class="btn btn-danger" style="flex:1" onclick="posPayEditSale()">Try Different Card</button>
      </div>
    </div>`;
  }
  function _posPayRenderStockFail(failed) {
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    status.innerHTML = `
    <div class="pos-pay-declined">
      <div style="font-size:30px;text-align:center">\u{1F4E6}</div>
      <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:#ffb4ab;text-align:center;margin:6px 0 10px">Stock Ran Out Mid-Sale</div>
      ${failed.map((f) => `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${_esc(f.e.item.name)} \u2014 ${_esc(f.reason)}</div>`).join("")}
      <button class="btn btn-ghost btn-block" style="margin-top:10px" onclick="posPayEditSale()">Back to Sale</button>
    </div>`;
  }
  function _posPayRenderReceipt(student, receiptItems, chargeable, failed) {
    const status = document.getElementById("pos-pay-status");
    if (!status) return;
    status.innerHTML = `
    <div class="pos-pay-success">
      <div style="font-size:38px;margin-bottom:6px">\u2705</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary);margin-bottom:2px">Payment Approved</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${_esc(student.name)} \xB7 new balance ${(student.coins || 0).toLocaleString()} \u{1FA99}</div>
      <div style="text-align:left;background:rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;margin-bottom:10px">
        ${receiptItems.map((r) => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0"><span>${r.item.emoji} ${_esc(r.item.name)} \xD7${r.qty}</span><span style="color:var(--tertiary)">${(r.item.cost * r.qty).toLocaleString()}</span></div>`).join("")}
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;padding-top:6px;margin-top:4px;border-top:1px solid rgba(255,255,255,.08)"><span>Total Charged</span><span style="color:var(--tertiary)">${chargeable.toLocaleString()} \u{1FA99}</span></div>
      </div>
      ${failed && failed.length ? `<div style="font-size:11px;color:#ffb95f;margin-bottom:10px">\u26A0\uFE0F ${failed.length} item(s) couldn't be added \u2014 ${failed.map((f) => _esc(f.e.item.name)).join(", ")}</div>` : ""}
      <button class="btn btn-success btn-block" onclick="posPayNewTransaction()">\u{1F9FE} New Sale</button>
    </div>`;
  }
  var posPayNewTransaction = function() {
    _posPayCart = {};
    _posPayManualStudentId = null;
    _posPayLastChargedTag = null;
    window.unmountPosPayCapture();
    _posPayRenderGrid();
    _posPayRenderCart();
    document.getElementById("pos-pay-search") && (document.getElementById("pos-pay-search").value = "");
  };
  async function _posPayAttemptCharge(studentId, method) {
    if (_posPayBusy) return;
    const student = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    const entries = Object.values(_posPayCart);
    if (!student) {
      _posPayRenderScanError("Student not found.");
      return;
    }
    if (!entries.length) {
      toast("Cart is empty.", "#ffb95f");
      return;
    }
    const total = entries.reduce((s, e) => s + e.item.cost * e.qty, 0);
    _posPayRenderProcessing(student);
    if ((student.coins || 0) < total) {
      _posPayRenderDeclined(student, total);
      return;
    }
    _posPayBusy = true;
    const succeeded = [];
    const failed = [];
    for (const e of entries) {
      const item = (AppStore.getSlice((s) => s.store) || []).find((i) => i.id === e.item.id);
      if (!item) {
        failed.push({ e, reason: "no longer available" });
        continue;
      }
      const { data, error } = await DBService2.rpc("purchase_shop_product", {
        p_product_id: item.id,
        p_student_id: studentId,
        p_quantity: e.qty
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (error || !result || !result.ok) {
        const remaining = result ? result.remaining_stock : item.stock;
        item.stock = remaining ?? item.stock;
        failed.push({ e, reason: `only ${remaining ?? 0} left` });
        continue;
      }
      item.stock = result.remaining_stock;
      succeeded.push({ e, item });
    }
    if (!succeeded.length) {
      _posPayBusy = false;
      _posPayRenderStockFail(failed);
      return;
    }
    const chargeable = succeeded.reduce((s, { e }) => s + e.item.cost * e.qty, 0);
    const cashier = (AppStore.getSlice((s) => s.admin) || {}).name || typeof currentUser !== "undefined" && currentUser && currentUser.name || "Teacher";
    const receiptItems = [];
    AppStore.updateState((draft) => {
      const s = (draft.students || []).find((x) => x.id === studentId);
      if (s) s.coins = (s.coins || 0) - chargeable;
      if (!Array.isArray(draft.orders)) draft.orders = [];
      if (!Array.isArray(draft.redemptions)) draft.redemptions = [];
      if (!draft.inventory) draft.inventory = {};
      if (!draft.inventory[studentId]) draft.inventory[studentId] = [];
      succeeded.forEach(({ e, item }) => {
        for (let q = 0; q < e.qty; q++) {
          const claimCode = posGenCode(draft.orders);
          const orderId = "POS-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900);
          draft.orders.unshift({
            orderId,
            claimCode,
            studentId,
            studentName: student.name,
            studentInit: student.init,
            studentColor: student.color,
            itemId: item.id,
            itemName: item.name,
            emoji: item.emoji,
            cost: item.cost,
            category: item.cat,
            status: "claimed",
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            createdDateStr: todayStr() + " at " + nowStr(),
            claimedAt: Date.now(),
            claimedBy: cashier,
            cancelledAt: null,
            cancelReason: null,
            entryMethod: method === "scan" ? "POS Card Tap" : "POS Manual"
          });
          draft.redemptions.unshift({
            studentId,
            itemId: item.id,
            itemName: item.name,
            emoji: item.emoji,
            item: `${item.emoji} ${item.name}`,
            pts: item.cost,
            date: todayStr(),
            time: nowStr(),
            orderId,
            claimCode
          });
        }
        const inv = draft.inventory[studentId];
        const existing = inv.find((i) => i.itemId === item.id);
        if (existing) {
          existing.quantity = (existing.quantity || 1) + e.qty;
          existing.lastPurchased = todayStr() + " " + nowStr();
        } else {
          inv.unshift({
            itemId: item.id,
            itemName: item.name,
            emoji: item.emoji,
            category: item.cat,
            quantity: e.qty,
            datePurchased: todayStr() + " at " + nowStr(),
            source: "Teacher POS",
            status: "active"
          });
        }
        receiptItems.push({ item, qty: e.qty });
        if (typeof promoRecordPurchase === "function") promoRecordPurchase(item.id, draft);
      });
    }, { type: "shop:pos-checkout", payload: { studentId, total: chargeable, itemCount: succeeded.length } });
    syncStudentStatsToServer(studentId, 0, -chargeable);
    const updatedStudent = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    if (typeof currentUser !== "undefined" && currentUser && currentUser.id === studentId) currentUser = updatedStudent;
    _posPayBusy = false;
    toast(`\u2705 ${chargeable.toLocaleString()} \u{1FA99} charged to ${_esc(student.name)}`, "#4edea3");
    succeeded.forEach(({ e }) => delete _posPayCart[e.item.id]);
    _posPayManualStudentId = null;
    _posPayRenderGrid();
    _posPayRenderCart();
    _posPayRenderReceipt(updatedStudent, receiptItems, chargeable, failed);
    if (typeof invUpdateSidebarBadge === "function" && typeof currentUser !== "undefined" && currentUser && currentUser.id === studentId) invUpdateSidebarBadge();
    if (typeof achCheckAndAward === "function") setTimeout(() => achCheckAndAward(studentId), 400);
  }
  var posFilterQueue = function() {
    const q = (document.getElementById("pos-queue-search")?.value || "").toLowerCase().trim();
    const cat = document.getElementById("pos-queue-cat")?.value || "all";
    let orders = (AppStore.getSlice((s) => s.orders) || []).filter((o) => o.status === "pending" || o.status === "ready");
    if (q) orders = orders.filter((o) => (o.studentName || "").toLowerCase().includes(q) || (o.itemName || "").toLowerCase().includes(q) || (o.claimCode || "").toLowerCase().includes(q));
    if (cat !== "all") orders = orders.filter((o) => o.category === cat);
    const list = document.getElementById("pos-queue-list");
    if (!list) return;
    if (!orders.length) {
      list.innerHTML = `<div style="text-align:center;padding:60px;border:2px dashed rgba(255,255,255,.07);border-radius:16px"><div style="font-size:48px;margin-bottom:16px">\u{1F389}</div><div style="font-family:var(--fh);font-size:18px;font-weight:800;color:var(--on-surface);margin-bottom:8px">${q || cat !== "all" ? "No matching orders" : "No Pending Orders"}</div><div style="color:var(--text-muted);font-size:13px">${q || cat !== "all" ? "Try adjusting your filters." : "All rewards have been distributed!"}</div></div>`;
      return;
    }
    list.innerHTML = orders.map((o) => `
  <div class="pos-queue-row">
    <div style="font-size:22px">${o.emoji || "\u{1F381}"}</div>
    <div style="min-width:0">
      <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(o.itemName)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap"><span style="color:${_cssColor(o.studentColor, "var(--primary)")}">\u{1F464} ${_esc(o.studentName)}</span><span>${(o.cost || 0).toLocaleString()} coins</span><span>${_esc(o.createdDateStr || "")}</span></div>
    </div>
    <div style="font-family:var(--fm);font-size:12px;color:var(--secondary);letter-spacing:.1em;flex-shrink:0">${_esc(o.claimCode)}</div>
    <div style="flex-shrink:0">${ordStatusPill(o.status)}</div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button class="btn btn-success btn-xs" onclick="posConfirmClaim('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:12px">check</span> Claim</button>
      <button class="btn btn-danger btn-xs" onclick="posCancelOrderPrompt('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:12px">close</span></button>
    </div>
  </div>`).join("");
  };
  var _posHistPage = 1;
  var _POS_HIST_PAGE_SIZE = 20;
  var posGoToHistPage = function(page) {
    _posHistPage = Math.max(1, page | 0);
    window.posFilterHistory(false);
    const list = document.getElementById("pos-hist-list");
    if (list) list.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  var posPrevHistPage = function() {
    window.posGoToHistPage(_posHistPage - 1);
  };
  var posNextHistPage = function() {
    window.posGoToHistPage(_posHistPage + 1);
  };
  function _posHistPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
    if (totalPages <= 1) {
      return `<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing all ${totalCount}</div>`;
    }
    const nums = /* @__PURE__ */ new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
    const pages = Array.from(nums).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    let btns = "";
    let prevN = 0;
    pages.forEach((n) => {
      if (n - prevN > 1) btns += `<span style="padding:0 6px;color:var(--text-muted);font-size:11px">\u2026</span>`;
      btns += `<button class="btn btn-ghost btn-sm" style="${n === page ? "background:var(--primary);color:#fff;font-weight:800" : ""}" onclick="posGoToHistPage(${n})">${n}</button>`;
      prevN = n;
    });
    return `
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${page <= 1 ? "disabled" : ""} onclick="posPrevHistPage()">\u2190 Prev</button>
    ${btns}
    <button class="btn btn-ghost btn-sm" ${page >= totalPages ? "disabled" : ""} onclick="posNextHistPage()">Next \u2192</button>
  </div>
  <div style="text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)">Showing ${rangeStart}\u2013${rangeEnd} of ${totalCount}</div>`;
  }
  var posFilterHistory = function(resetPage) {
    if (resetPage !== false) _posHistPage = 1;
    const q = (document.getElementById("pos-hist-search")?.value || "").toLowerCase().trim();
    const filter = document.getElementById("pos-hist-filter")?.value || "claimed";
    let orders = AppStore.getSlice((s) => s.orders) || [];
    if (filter === "claimed") orders = orders.filter((o) => o.status === "claimed");
    else if (filter === "cancelled") orders = orders.filter((o) => o.status === "cancelled");
    else orders = orders.filter((o) => o.status === "claimed" || o.status === "cancelled");
    if (q) orders = orders.filter((o) => (o.studentName || "").toLowerCase().includes(q) || (o.itemName || "").toLowerCase().includes(q));
    const list = document.getElementById("pos-hist-list");
    if (!list) return;
    if (!orders.length) {
      list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:13px"><div style="font-size:40px;margin-bottom:12px">\u{1F4CB}</div>No history found.</div>`;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(orders.length / _POS_HIST_PAGE_SIZE));
    if (_posHistPage > totalPages) _posHistPage = totalPages;
    const start = (_posHistPage - 1) * _POS_HIST_PAGE_SIZE;
    const shown = orders.slice(start, start + _POS_HIST_PAGE_SIZE);
    list.innerHTML = `<table class="admin-table" style="width:100%">
    <thead><tr><th>Item</th><th>Student</th><th>Claim Code</th><th>Coins</th><th>Ordered</th><th>Status</th><th>Resolved</th></tr></thead>
    <tbody>${shown.map((o) => `<tr>
      <td><span style="font-size:16px;margin-right:6px">${o.emoji || "\u{1F381}"}</span>${_esc(o.itemName)}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><span style="width:24px;height:24px;border-radius:50%;background:${_cssColor(o.studentColor)}22;border:1px solid ${_cssColor(o.studentColor)}44;color:${_cssColor(o.studentColor)};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;font-family:var(--fh)">${_esc(o.studentInit || "?")}</span>${_esc(o.studentName)}</div></td>
      <td><span style="font-family:var(--fm);font-size:11px;color:${o.status === "claimed" ? "var(--secondary)" : "var(--text-muted)"}">${_esc(o.claimCode)}</span></td>
      <td><span style="color:var(--tertiary);font-weight:700">${(o.cost || 0).toLocaleString()}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${_esc(o.createdDateStr || "")}</td>
      <td>${ordStatusPill(o.status)}</td>
      <td style="color:var(--text-muted);font-size:11px">${o.claimedAt ? new Date(o.claimedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : o.cancelledAt ? new Date(o.cancelledAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
    </tr>`).join("")}</tbody>
  </table>
  ${_posHistPagination(_posHistPage, totalPages, orders.length, start + 1, start + shown.length)}`;
  };
  function _posAnalyticsHTML() {
    const orders = AppStore.getSlice((s) => s.orders) || [];
    const today = isoDate ? isoDate() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const todayOrds = orders.filter((o) => o.status === "claimed" && o.claimedAt && new Date(o.claimedAt).toISOString().slice(0, 10) === today);
    const weekAgo = /* @__PURE__ */ new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekOrds = orders.filter((o) => o.status === "claimed" && o.claimedAt && new Date(o.claimedAt) >= weekAgo);
    const totalCoinsSpent = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + (o.cost || 0), 0);
    const itemCounts = {};
    orders.filter((o) => o.status === "claimed").forEach((o) => {
      if (!itemCounts[o.itemId]) itemCounts[o.itemId] = { name: o.itemName, emoji: o.emoji, count: 0, coins: 0 };
      itemCounts[o.itemId].count++;
      itemCounts[o.itemId].coins += o.cost || 0;
    });
    const topItems = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 8);
    const dailyCounts = {};
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyCounts[key] = { label: d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }), count: 0 };
    }
    weekOrds.forEach((o) => {
      const k = new Date(o.claimedAt).toISOString().slice(0, 10);
      if (dailyCounts[k]) dailyCounts[k].count++;
    });
    const maxDay = Math.max(1, ...Object.values(dailyCounts).map((d) => d.count));
    const catCounts = { food: 0, supplies: 0, privilege: 0, mystery: 0 };
    orders.filter((o) => o.status === "claimed").forEach((o) => {
      catCounts[o.category] = (catCounts[o.category] || 0) + 1;
    });
    const catTotal = Object.values(catCounts).reduce((s, c) => s + c, 0) || 1;
    const catColors = { food: "var(--secondary)", supplies: "var(--primary)", privilege: "var(--tertiary)", mystery: "#fb923c" };
    const catIcons = { food: "\u{1F354}", supplies: "\u{1F4E6}", privilege: "\u2B50", mystery: "\u2753" };
    const catLabels = { food: "Food", supplies: "Supplies", privilege: "Privilege", mystery: "Mystery" };
    return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:28px">
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--secondary)">${todayOrds.length}</div><div class="pos-stat-lbl">Today's Redemptions</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--primary)">${weekOrds.length}</div><div class="pos-stat-lbl">This Week</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--tertiary)">${totalCoinsSpent.toLocaleString()}</div><div class="pos-stat-lbl">Total Coins Spent</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:#4edea3">${orders.filter((o) => o.status === "claimed").length}</div><div class="pos-stat-lbl">All-Time Claimed</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--error)">${orders.filter((o) => o.status === "cancelled").length}</div><div class="pos-stat-lbl">Cancelled</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:#fb923c">${orders.filter((o) => o.status === "pending").length}</div><div class="pos-stat-lbl">Still Pending</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:20px;margin-bottom:24px">
    <div class="glass-card">
      <h3 style="margin-bottom:16px">\u{1F4C5} Daily Redemptions (Last 7 Days)</h3>
      <div style="display:flex;align-items:flex-end;gap:8px;height:100px;padding-bottom:4px">
        ${Object.values(dailyCounts).map((d) => {
      const pct = Math.round(d.count / maxDay * 100) || 0;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:10px;color:var(--secondary);font-weight:700">${d.count > 0 ? d.count : ""}</div><div style="width:100%;background:${d.count > 0 ? "rgba(78,222,163,.7)" : "rgba(255,255,255,.05)"};border-radius:4px 4px 0 0;height:${Math.max(4, pct)}px;min-height:4px;transition:height .3s"></div><div style="font-size:9px;color:var(--text-muted);text-align:center;white-space:nowrap;overflow:hidden;max-width:40px">${d.label.split(",")[0]}</div></div>`;
    }).join("")}
      </div>
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">\u{1F4E6} By Category</h3>
      ${Object.entries(catCounts).map(([cat, count]) => {
      const pct = Math.round(count / catTotal * 100);
      return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:var(--text-muted)">${catIcons[cat] || ""} ${catLabels[cat] || cat}</span><span style="color:${catColors[cat] || "var(--text-muted)"};font-weight:700">${count} <span style="color:var(--text-muted);font-weight:400">(${pct}%)</span></span></div><div style="background:rgba(255,255,255,.05);border-radius:4px;height:6px;overflow:hidden"><div style="height:100%;border-radius:4px;background:${catColors[cat] || "var(--primary)"};width:${pct}%;transition:width .4s"></div></div></div>`;
    }).join("")}
    </div>
  </div>
  <div class="glass-card">
    <h3 style="margin-bottom:16px">\u{1F3C6} Most Redeemed Items</h3>
    ${!topItems.length ? `<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px">No redemptions yet.</div>` : topItems.map((item, i) => `<div class="item-rank-chip"><div class="item-rank-num">#${i + 1}</div><div style="font-size:22px;flex-shrink:0">${item.emoji || "\u{1F381}"}</div><div style="flex:1;min-width:0"><div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(item.name)}</div><div style="font-size:11px;color:var(--text-muted)"><span style="color:var(--tertiary)">${item.coins.toLocaleString()} coins</span> total spent</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--secondary)">${item.count}</div><div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">claimed</div></div></div>`).join("")}
  </div>`;
  }
  (function() {
    const _orig = window.renderAnalytics;
    window.renderAnalytics = function() {
      if (typeof _orig === "function") _orig();
      const orders = AppStore.getSlice((s) => s.orders) || [];
      const pending = orders.filter((o) => o.status === "pending").length;
      const claimed = orders.filter((o) => o.status === "claimed").length;
      const sect = document.getElementById("a-analytics");
      if (!sect) return;
      const block = `
    <div style="background:rgba(26,20,56,.8);border:1px solid rgba(78,222,163,.2);border-radius:16px;padding:20px;margin-bottom:24px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.16em;margin-bottom:14px;text-transform:uppercase">\u{1F3EA} POS & Orders Overview</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--tertiary)">${pending}</div><div class="pos-stat-lbl">Pending Orders</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--secondary)">${claimed}</div><div class="pos-stat-lbl">Claimed Rewards</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--primary)">${orders.length}</div><div class="pos-stat-lbl">Total Orders</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:#ffb95f">${orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + (o.cost || 0), 0).toLocaleString()}</div><div class="pos-stat-lbl">Coins Spent</div></div>
      </div>
      <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="navTo('a-pos')"><span class="material-symbols-outlined" style="font-size:14px">point_of_sale</span> Open POS Terminal</button></div>
    </div>`;
      sect.innerHTML = block + (sect.innerHTML || "");
    };
  })();
  console.log("[EduQuest] shop/pos-terminal.js loaded \u2014 renderPOS, pos* functions, renderAnalytics patched.");
  window._posPayRenderGrid = _posPayRenderGrid;

  // build/test-helpers/shop_pos_terminal-globals.js
  window.AppStore = AppStore;
  window.DBService = DBService2;
  window.toast = toast;
  window.showModal = showModal;
  window.closeModalForce = closeModalForce;
  window.__peek = () => ({
    cart: _posPayCart,
    manual: _posPayManualStudentId,
    armed: _posPayScanArmed,
    focusInterval: !!_posPayCaptureFocusInterval,
    captureTimer: !!_posPayCaptureTimer,
    lastTag: _posPayLastChargedTag,
    lastAt: _posPayLastChargeAt,
    busy: _posPayBusy,
    hist: _posHistPage,
    histSize: _POS_HIST_PAGE_SIZE
  });

  // build/bridges/shop_pos_terminal.bridge.js
  window.renderPOS = renderPOS;
  window.posSwitchTab = posSwitchTab;
  window.posLookupCode = posLookupCode;
  window.posConfirmClaim = posConfirmClaim;
  window.posExecuteClaim = posExecuteClaim;
  window.posCancelOrderPrompt = posCancelOrderPrompt;
  window.posExecuteCancel = posExecuteCancel;
  window._posPayTotal = _posPayTotal;
  window._posPayRenderPanel = _posPayRenderPanel;
  window._posPayRenderGrid = _posPayRenderGrid;
  window.posPayAddItem = posPayAddItem;
  window.posPayIncQty = posPayIncQty;
  window.posPayDecQty = posPayDecQty;
  window.posPayClearCart = posPayClearCart;
  window._posPayRenderCart = _posPayRenderCart;
  window._posPayIdleStatusHTML = _posPayIdleStatusHTML;
  window._posPayStartCapture = _posPayStartCapture;
  window.unmountPosPayCapture = unmountPosPayCapture;
  window._posPayOnCaptureInput = _posPayOnCaptureInput;
  window._posPayFinalizeCapture = _posPayFinalizeCapture;
  window.posPayArmScan = posPayArmScan;
  window.posPayCancelScan = posPayCancelScan;
  window.posPayEditSale = posPayEditSale;
  window._posPayHandleTag = _posPayHandleTag;
  window._posPayRenderScanError = _posPayRenderScanError;
  window.posPaySearchStudent = posPaySearchStudent;
  window.posPaySelectStudent = posPaySelectStudent;
  window.posPayManualCharge = posPayManualCharge;
  window._posPayRenderProcessing = _posPayRenderProcessing;
  window._posPayRenderDeclined = _posPayRenderDeclined;
  window._posPayRenderStockFail = _posPayRenderStockFail;
  window._posPayRenderReceipt = _posPayRenderReceipt;
  window.posPayNewTransaction = posPayNewTransaction;
  window._posPayAttemptCharge = _posPayAttemptCharge;
  window.posFilterQueue = posFilterQueue;
  window.posGoToHistPage = posGoToHistPage;
  window.posPrevHistPage = posPrevHistPage;
  window.posNextHistPage = posNextHistPage;
  window._posHistPagination = _posHistPagination;
  window.posFilterHistory = posFilterHistory;
  window._posAnalyticsHTML = _posAnalyticsHTML;
})();
