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
            const uid3 = sd && sd.session && sd.session.user && sd.session.user.id;
            if (uid3) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, uid3);
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
  function uid2() {
    return "id_" + Math.random().toString(36).substr(2, 9);
  }
  function _esc2(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

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

  // src/modules/titles/titles_admin_page.js
  var renderAdminTitles = function() {
    const titles = AppStore.getSlice((s) => s.titles) || [];
    const dest = document.getElementById("a-titles") || document.getElementById("a-achievements");
    if (!dest) return;
    const totalUnlocks = Object.values(AppStore.getSlice((s) => s.titleUnlocks) || {}).reduce((s, arr) => s + arr.length, 0);
    const equippedTitles = AppStore.getSlice((s) => s.equippedTitles) || {};
    const equipped = Object.keys(equippedTitles).filter((sid) => equippedTitles[sid]).length;
    dest.innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="page-hero-label">\u{1F451} Title Designer</div>
        <h1 style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Titles &amp; Nameplates</h1>
        <p style="font-size:13px;color:var(--text-muted)">${titles.length} titles \xB7 ${totalUnlocks} total unlocks \xB7 ${equipped} currently equipped</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="tsAdminGrantModal()">\u{1F381} Grant/Revoke</button>
        <button class="btn btn-primary" onclick="tsAdminOpenDesigner(null)">+ Create Title</button>
      </div>
    </div>
  </div>

  <div class="ts-form-tabs" style="margin-bottom:24px">
    <button class="ts-form-tab active" id="tsadmtab-library" onclick="tsAdminTabSwitch('library')">\u{1F4DA} Title Library</button>
    <button class="ts-form-tab" id="tsadmtab-stats"   onclick="tsAdminTabSwitch('stats')">\u{1F4CA} Statistics</button>
  </div>

  <div id="tsadm-panel-library" class="ts-form-panel active">
    ${_buildAdminTitlesList(titles)}
  </div>

  <div id="tsadm-panel-stats" class="ts-form-panel">
    ${_buildAdminTitleStats(titles)}
  </div>`;
  };
  function _buildAdminTitlesList(titles) {
    if (!titles.length) {
      return `<div style="text-align:center;padding:72px 20px;border:2px dashed rgba(255,255,255,.07);border-radius:16px">
      <div style="font-size:56px;margin-bottom:14px">\u{1F451}</div>
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:8px">No Titles Created</div>
      <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px">Create your first custom title using the Visual Designer.</div>
      <button class="btn btn-primary" onclick="tsAdminOpenDesigner(null)">+ Create First Title</button>
    </div>`;
    }
    const titleUnlocks = AppStore.getSlice((s) => s.titleUnlocks) || {};
    const equippedTitles = AppStore.getSlice((s) => s.equippedTitles) || {};
    const achievements = AppStore.getSlice((s) => s.achievements) || [];
    const titleSectionAssignments = AppStore.getSlice((s) => s.titleSectionAssignments) || {};
    return `<div class="ts-admin-cards-grid">
    ${titles.map((t) => {
      const unlockCount = Object.values(titleUnlocks).filter((arr) => arr.includes(t.id)).length;
      const equippedBy = Object.entries(equippedTitles).filter(([, tid]) => tid === t.id).length;
      const linkedAch = t.achievementId ? achievements.find((a) => a.id === t.achievementId) : null;
      const assignedIds = titleSectionAssignments[t.id] || [];
      const sectionsLabel = assignedIds.length ? assignedIds.map((cid) => typeof getClassLabel === "function" ? getClassLabel(cid) : cid).join(", ") : "All sections";
      return `<div class="ts-admin-card${!t.active ? " ts-admin-card-inactive" : ""}">
        <div class="ts-admin-card-preview">
          ${tsBuildBadgeHTML(t, { noParticles: true })}
          ${!t.active ? '<span style="position:absolute;top:6px;right:6px;background:rgba(255,180,171,.18);color:#ffb4ab;border:1px solid rgba(255,180,171,.3);border-radius:6px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.06em">DISABLED</span>' : ""}
        </div>
        <div class="ts-admin-card-body">
          <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface);margin-bottom:4px">${_esc2(t.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;line-height:1.4">${_esc2(t.description || "")}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <span class="rarity-pill rarity-${(t.rarity || "Common").toLowerCase()}" style="font-size:9px">${t.rarity}</span>
            <span style="font-size:9px;color:var(--text-muted);border:1px solid var(--border2);border-radius:6px;padding:2px 7px">${t.frameShape || "classic"}</span>
            ${linkedAch ? `<span class="badge-pill bp-primary" style="font-size:9px">\u{1F517} ${_esc2(linkedAch.name)}</span>` : `<span class="badge-pill ${assignedIds.length ? "bp-primary" : "bp-gray"}" style="font-size:9px" title="${_esc2(sectionsLabel)}">\u{1F3EB} ${assignedIds.length ? _esc2(sectionsLabel) : "All sections"}</span>`}
          </div>
          <div style="display:flex;gap:10px;font-size:11px;margin-bottom:10px">
            <span style="color:var(--text-muted)">Unlocks: <strong style="color:var(--primary)">${unlockCount}</strong></span>
            <span style="color:var(--text-muted)">Equipped: <strong style="color:var(--secondary)">${equippedBy}</strong></span>
          </div>
          <div class="ts-admin-card-actions">
            <button class="btn btn-ghost btn-xs" onclick="tsAdminOpenDesigner('${t.id}')" title="Edit">\u270F\uFE0F Edit</button>
            <button class="btn btn-ghost btn-xs" onclick="tsAdminDuplicate('${t.id}')" title="Duplicate">\u29C9</button>
            <button class="ach-toggle-btn" style="border-color:${t.active ? "rgba(255,128,128,0.3)" : "rgba(78,222,163,0.3)"};color:${t.active ? "#ff8080" : "#4edea3"}" onclick="tsAdminToggle('${t.id}')">${t.active ? "Disable" : "Enable"}</button>
            <button class="btn btn-ghost btn-xs" style="color:#ff8080" onclick="tsAdminDelete('${t.id}')">\u{1F5D1}</button>
          </div>
        </div>
      </div>`;
    }).join("")}
  </div>`;
  }
  function _buildAdminTitleStats(titles) {
    const rarityBuckets = {};
    titles.forEach((t) => {
      rarityBuckets[t.rarity] = (rarityBuckets[t.rarity] || 0) + 1;
    });
    const shapeBuckets = {};
    titles.forEach((t) => {
      const s = t.frameShape || "classic";
      shapeBuckets[s] = (shapeBuckets[s] || 0) + 1;
    });
    const titleUnlocks = AppStore.getSlice((s) => s.titleUnlocks) || {};
    const equippedTitles = AppStore.getSlice((s) => s.equippedTitles) || {};
    const topUnlocked = titles.map((t) => ({ t, count: Object.values(titleUnlocks).filter((arr) => arr.includes(t.id)).length })).sort((a, b) => b.count - a.count).slice(0, 6);
    const topEquipped = titles.map((t) => ({ t, count: Object.entries(equippedTitles).filter(([, tid]) => tid === t.id).length })).sort((a, b) => b.count - a.count).slice(0, 6);
    return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
    <div class="glass-card">
      <h3 style="margin-bottom:14px">Top Unlocked Titles</h3>
      ${topUnlocked.map(({ t, count }) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--on-surface)">${_esc2(t.name)}</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--primary)">${count}</div>
      </div>`).join("")}
      ${!topUnlocked.length ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">No unlocks yet</div>' : ""}
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">Most Equipped</h3>
      ${topEquipped.map(({ t, count }) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--on-surface)">${_esc2(t.name)}</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary)">${count}</div>
      </div>`).join("")}
      ${!topEquipped.length ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">No equipped titles yet</div>' : ""}
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">By Rarity</h3>
      ${["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"].map((r) => {
      const cnt = rarityBuckets[r] || 0;
      const pct = titles.length ? Math.round(cnt / titles.length * 100) : 0;
      const rCol = { Common: "#9ca3af", Uncommon: "#4ade80", Rare: "#60a5fa", Epic: "#c084fc", Legendary: "#fbbf24", Mythic: "#f472b6" }[r] || "#9ca3af";
      return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:${rCol};font-weight:700">${r}</span><span style="color:var(--text-muted)">${cnt} (${pct}%)</span></div><div style="background:rgba(255,255,255,.05);border-radius:4px;height:6px;overflow:hidden"><div style="height:100%;border-radius:4px;background:${rCol};width:${pct}%;transition:width .4s"></div></div></div>`;
    }).join("")}
    </div>
  </div>`;
  }
  var tsAdminTabSwitch = function(tab) {
    ["library", "stats"].forEach((t) => {
      const btn = document.getElementById("tsadmtab-" + t);
      const pnl = document.getElementById("tsadm-panel-" + t);
      if (btn) btn.classList.toggle("active", t === tab);
      if (pnl) pnl.classList.toggle("active", t === tab);
    });
  };
  var _tsRefreshAdminTitlesPanel = function() {
    const panel = document.getElementById("tsadm-panel-library");
    if (panel) panel.innerHTML = _buildAdminTitlesList(AppStore.getSlice((s) => s.titles) || []);
  };
  var tsAdminDelete = async function(titleId) {
    const t = (AppStore.getSlice((s) => s.titles) || []).find((x) => x.id === titleId);
    if (!t || !confirm(`Delete title "${t.name}"? This will remove all unlocks and unequip from all students.`)) return;
    AppStore.updateState((draft) => {
      draft.titles = (draft.titles || []).filter((x) => x.id !== titleId);
      if (draft.titleUnlocks) {
        Object.keys(draft.titleUnlocks).forEach((sid) => {
          if ((draft.titleUnlocks[sid] || []).includes(titleId)) {
            draft.titleUnlocks[sid] = draft.titleUnlocks[sid].filter((id) => id !== titleId);
          }
        });
      }
      if (draft.equippedTitles) {
        Object.keys(draft.equippedTitles).forEach((sid) => {
          if (draft.equippedTitles[sid] === titleId) draft.equippedTitles[sid] = null;
        });
      }
    }, { type: "titles:title-deleted", payload: { id: titleId } });
    toast("\u{1F5D1} Title deleted.", "#ff8080");
    renderAdminTitles();
    if (typeof DBService2 !== "undefined" && typeof DBService2.rpc === "function") {
      const { error } = await DBService2.rpc("delete_title", { p_title_id: titleId });
      if (error) toast("\u26A0\uFE0F Removed locally, but may not have synced: " + error.message, "#ffb95f");
    }
  };
  var tsAdminToggle = function(tid) {
    const existing = (AppStore.getSlice((s) => s.titles) || []).find((t) => t.id === tid);
    if (!existing) return;
    let newActive = null;
    AppStore.updateState((draft) => {
      const idx = (draft.titles || []).findIndex((t) => t.id === tid);
      if (idx < 0) return;
      draft.titles[idx].active = !draft.titles[idx].active;
      newActive = draft.titles[idx].active;
    }, { type: "titles:toggled", payload: { id: tid } });
    toast(newActive ? "\u2705 Title enabled." : "\u23F8 Title disabled.");
    _tsRefreshAdminTitlesPanel();
  };
  var tsAdminDuplicate = function(tid) {
    const orig = (AppStore.getSlice((s) => s.titles) || []).find((t) => t.id === tid);
    if (!orig) return;
    AppStore.updateState((draft) => {
      if (!Array.isArray(draft.titles)) draft.titles = [];
      draft.titles.push({ ...orig, id: uid2(), ownerTeacherId: orig.ownerTeacherId || currentUser.id, name: orig.name + " (Copy)", createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    }, { type: "titles:duplicated", payload: { sourceId: tid } });
    toast("\u29C9 Title duplicated!");
    _tsRefreshAdminTitlesPanel();
  };
  var tsAdminGrantModal = function() {
    const titles = AppStore.getSlice((s) => s.titles) || [];
    if (!titles.length) {
      toast("\u274C Create titles first.", "#ffb4ab");
      return;
    }
    const students = AppStore.getSlice((s) => s.students) || [];
    const studentOpts = students.map((s) => `<option value="${s.id}">${_esc2(s.name)}</option>`).join("");
    const titleOpts = titles.map((t) => `<option value="${t.id}">${t.icon || "\u{1F451}"} ${_esc2(t.name)}</option>`).join("");
    showModal(`
  <div style="max-width:480px">
    <h2 style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:18px">\u{1F381} Grant / Revoke Titles</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
      <div><label class="form-label">Student *</label><select id="tsg-student" class="form-control" style="width:100%" onchange="tsAdminGrantRefreshStudentTitles()"><option value="">Select...</option>${studentOpts}</select></div>
      <div><label class="form-label">Title *</label><select id="tsg-title" class="form-control" style="width:100%"><option value="">Select...</option>${titleOpts}</select></div>
    </div>
    <div id="tsg-student-titles" style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px;margin-bottom:14px;display:none">
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Student's Current Titles</div>
      <div id="tsg-student-titles-list"></div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="radio" name="tsg-action" value="grant" id="tsg-act-grant" checked style="width:16px;height:16px;cursor:pointer">
        <label for="tsg-act-grant" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#4edea3">Grant Title</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Unlock this title for the student (they can equip it)</div></label>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="radio" name="tsg-action" value="revoke" id="tsg-act-revoke" style="width:16px;height:16px;cursor:pointer">
        <label for="tsg-act-revoke" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#ff8080">Revoke Title</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Remove title unlock and unequip if active</div></label>
      </div>
    </div>
    <div id="tsg-err" style="color:#ff8080;font-size:12px;display:none;margin-bottom:10px"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="tsAdminGrantConfirm()">Execute</button>
    </div>
  </div>`, "md");
  };
  var tsAdminGrantRefreshStudentTitles = function() {
    const sid = document.getElementById("tsg-student")?.value;
    const box = document.getElementById("tsg-student-titles");
    const lst = document.getElementById("tsg-student-titles-list");
    if (!sid || !box || !lst) return;
    const unlocked = tsGetUnlockedTitles(sid);
    const equippedId = (AppStore.getSlice((s) => s.equippedTitles) || {})[sid];
    box.style.display = "block";
    if (!unlocked.length) {
      lst.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No titles unlocked yet</span>';
      return;
    }
    lst.innerHTML = unlocked.map((t) => {
      const isE = t.id === equippedId;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
      <span style="flex:1;font-size:12px;font-weight:700">${_esc2(t.name)}</span>
      ${isE ? '<span style="font-size:9px;color:var(--secondary);font-weight:800;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.25);padding:1px 6px;border-radius:6px">EQUIPPED</span>' : ""}
      <button onclick="tsAdminRevokeTitle('${sid}','${t.id}')" style="background:none;border:none;color:rgba(255,128,128,.5);cursor:pointer;font-size:12px;padding:0">\u2715</button>
    </div>`;
    }).join("");
  };
  var tsAdminGrantConfirm = function() {
    const sid = document.getElementById("tsg-student")?.value;
    const tid = document.getElementById("tsg-title")?.value;
    const action = document.querySelector('input[name="tsg-action"]:checked')?.value || "grant";
    const errEl = document.getElementById("tsg-err");
    if (!sid) {
      if (errEl) {
        errEl.textContent = "Please select a student.";
        errEl.style.display = "block";
      }
      return;
    }
    if (!tid) {
      if (errEl) {
        errEl.textContent = "Please select a title.";
        errEl.style.display = "block";
      }
      return;
    }
    if (errEl) errEl.style.display = "none";
    const student = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === sid);
    const title = (AppStore.getSlice((s) => s.titles) || []).find((t) => t.id === tid);
    if (!student || !title) return;
    if (action === "grant") {
      if (tsIsUnlocked(sid, tid)) {
        if (errEl) {
          errEl.textContent = "\u274C Student already has this title.";
          errEl.style.display = "block";
        }
        return;
      }
      tsUnlockTitleForStudent(sid, tid, true);
      closeModalForce();
      toast(`\u2705 Granted "${_esc2(title.name)}" to ${_esc2(student.name)}!`);
    } else {
      if (!tsIsUnlocked(sid, tid)) {
        if (errEl) {
          errEl.textContent = "\u274C Student does not have this title.";
          errEl.style.display = "block";
        }
        return;
      }
      tsAdminRevokeTitle(sid, tid);
      closeModalForce();
      toast(`\u{1F5D1} Revoked "${_esc2(title.name)}" from ${_esc2(student.name)}.`, "#ff8080");
    }
    renderAdminTitles();
  };
  var tsAdminRevokeTitle = function(sid, tid) {
    AppStore.updateState((draft) => {
      if (!draft.titleUnlocks) draft.titleUnlocks = {};
      draft.titleUnlocks[sid] = (draft.titleUnlocks[sid] || []).filter((id) => id !== tid);
      if (draft.equippedTitles && draft.equippedTitles[sid] === tid) draft.equippedTitles[sid] = null;
    }, { type: "titles:revoked", payload: { sid, tid } });
    syncTitleRevokeToServer(sid, tid);
    tsAdminGrantRefreshStudentTitles();
  };
  AppStore.subscribe("titles-admin-achievements-link", function(state, event) {
    if (event.type !== "admin:achievements-rendered") return;
    const dest = document.getElementById("a-achievements");
    if (!dest) return;
    const existing = dest.querySelector(".ts-ach-titles-link");
    if (existing) return;
    const bar = dest.querySelector(".page-hero > div > div:last-child") || dest.querySelector(".page-hero-stats") || dest.querySelector('div[style*="justify-content:space-between"]');
    if (bar) {
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-sm ts-ach-titles-link";
      btn.innerHTML = "\u{1F451} Manage Titles";
      btn.style.cssText = "margin-top:8px";
      btn.addEventListener("click", () => {
        if (typeof navTo === "function") navTo("a-titles");
        else if (typeof renderAdminTitles === "function") {
          renderAdminTitles();
        }
      });
      bar.appendChild(btn);
    }
  });
  console.log("[EduQuest] titles/admin-page.js loaded \u2014 renderAdminTitles, tsAdmin* CRUD, grant/revoke modal, admin:achievements-rendered subscriber registered.");

  // build/bridges/titles_admin_page.bridge.js
  window.renderAdminTitles = renderAdminTitles;
  window._buildAdminTitlesList = _buildAdminTitlesList;
  window._buildAdminTitleStats = _buildAdminTitleStats;
  window.tsAdminTabSwitch = tsAdminTabSwitch;
  window._tsRefreshAdminTitlesPanel = _tsRefreshAdminTitlesPanel;
  window.tsAdminDelete = tsAdminDelete;
  window.tsAdminToggle = tsAdminToggle;
  window.tsAdminDuplicate = tsAdminDuplicate;
  window.tsAdminGrantModal = tsAdminGrantModal;
  window.tsAdminGrantRefreshStudentTitles = tsAdminGrantRefreshStudentTitles;
  window.tsAdminGrantConfirm = tsAdminGrantConfirm;
  window.tsAdminRevokeTitle = tsAdminRevokeTitle;
})();
