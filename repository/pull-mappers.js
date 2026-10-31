// ─────────────────────────────────────────────────────────────────────────────
// REPOSITORY — pull-side cache mappers (Priority 2 Fix 1)
//
// Phase 6 (Decompose God Files) extraction from db-service.js. Owns the
// per-table transform from raw Supabase row data to the LEGACY cache shape
// every existing module already reads/writes (DB.students[], DB.bossEvents[],
// etc.) — one function per table, plus the role-name translator and the
// bounded-history-window limits table both derive functions and the pull
// orchestrator (still in db-service.js) rely on. This is the "read" mirror
// of repository/table-sync.js (Phase 5A/5B's "write" side, extracted in
// session 2) — together they're the full cache<->relational mapping layer,
// now living in the same directory as two focused files instead of one.
// No behavior change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): grepped this entire block for every reference to db-service.js's
// OTHER internals — _cache, _getClient(), _meta, _localStorageProvider,
// _pushCacheToSupabase — and found none. Unlike _pullCacheFromSupabase()
// itself (which reads `_cache` directly as a fallback for a couple of
// locally-cache-only fields, and stayed in db-service.js for exactly that
// reason — see this session's Refactoring Report entry), every function
// here takes only its own raw-row-data parameters and returns a plain
// object/array. That's what made this a clean seam and _pullCacheFromSupabase
// itself not one: this file has no state to be coupled to.
//
// Exports: _legacyRoleFromDbRole(), _deriveStudents(), _deriveAdmin(),
//   _deriveEquippedTitles(), _deriveBossEvents(), _deriveBossParticipants(),
//   _deriveAchievements(), _deriveAchievementUnlocks(), _deriveTitles(),
//   _deriveTitleUnlocks(), _deriveTitleSectionAssignments(), _deriveQuizzes(),
//   _deriveCampaignWorlds(), _deriveCampaignSectionAssignments(),
//   _deriveMail(), _deriveQuizSectionAssignments(),
//   _deriveAchievementSectionAssignments(), _deriveInventory(),
//   _deriveQuizHistory(), _deriveStudentSkills(), _derivePointLog(),
//   _deriveRedemptions(), _deriveOrders(), _deriveNotifications(),
//   _deriveRecitationLog(), _deriveRecitationSessions(), _deriveRfidCards(),
//   _deriveAttendanceSchedules(), _deriveAttendanceLogs(), _deriveStore(),
//   _deriveRegistrations()
//   Also declares: _HISTORY_LIMITS
//
// DEPENDENCIES: none beyond its own parameters — no globals required. Must
// load before db-service.js (see index.html) since _pullCacheFromSupabase()
// and the scoped realtime refresh both call these by name — though as with
// every other Phase 6 split, nothing here runs at load time beyond
// declarations, so load order doesn't actually affect correctness, only
// reading order.
// ─────────────────────────────────────────────────────────────────────────────

  // ── Cache <-> relational mapping ──────────────────────────────────────────
  // Translates the LEGACY shape (DB.students[], DB.bossEvents[], etc. — the
  // shape every existing module already reads/writes) to/from the relational
  // tables defined in 01_schema.sql / 02_policies.sql. This is the seam that
  // lets db-schema.js, state-manager.js, and every domain module stay
  // unchanged while the storage underneath becomes relational.

  function _legacyRoleFromDbRole(role) {
    return role === 'admin' ? 'admin' : (role === 'teacher' ? 'teacher' : 'student');
  }

  // ── Priority 2 Fix 2: bounded history windows ─────────────────────────────
  // These 8 append-only tables previously came back with COMPLETE, unbounded
  // history on every single pull — including the first-login blocking pull.
  // See EduQuest_Priority2_Plan.md "Fix 2". Limits below are a first pass
  // (200-500 rows), not exact science — point_log/quiz_history/
  // attendance_logs get a larger window since older rows still feed streak/
  // analytics math; notifications only needs enough to fill the bell
  // dropdown. loadMoreHistory() (public API, near the bottom of this file)
  // is the escape hatch for anything that needs to page further back.
  const _HISTORY_LIMITS = {
    point_log: 500,
    redemptions: 300,
    recitation_log: 300,
    attendance_logs: 500,
    mail_messages: 300,
    orders: 300,
    quiz_history: 500,
    notifications: 100,
  };

  // ── Priority 2 Fix 1: per-table derive helpers ────────────────────────────
  // Every one of these mirrors a transform that used to be written inline,
  // once, inside _pullCacheFromSupabase()'s giant return statement. Pulled
  // out into standalone functions so BOTH the full 27-table pull below AND
  // the scoped realtime refresh (_REFRESH_GROUPS, further down) share the
  // exact same transform logic — one source of truth, no risk of the two
  // paths silently drifting apart. See EduQuest_Priority2_Plan.md "Fix 1".

  function _deriveStudents(profilesData, quizHistoryByStudent) {
    const qh = quizHistoryByStudent || {};
    return (profilesData || [])
      .filter(p => p.role === 'student')
      .map(p => ({
        id: p.id, pass: p.pass, name: p.display_name, init: p.init, color: p.color,
        xp: p.xp, coins: p.coins, level: p.level, tier: p.tier,
        attendance: Number(p.attendance_pct) || 0, quizAvg: Number(p.quiz_avg) || 0,
        firstName: p.first_name, lastName: p.last_name,
        displayName: p.display_name, profilePic: p.profile_pic_url,
        joinDate: p.join_date, classId: p.class_id || 'default-class',
        // Phase 63 completedQuizzes — built from the already-shaped
        // quizHistoryByStudent map (id: [{quizId, aborted, ...}]) rather
        // than raw quiz_history rows, so this same function works whether
        // the caller just did a fresh quiz_history pull (full pull) or is
        // reusing the existing cached quizHistory slice unchanged (scoped
        // 'profiles' group refresh, where quiz_history itself didn't change).
        completedQuizzes: Array.from(new Set(
          (qh[p.id] || []).filter(h => !h.aborted).map(h => h.quizId)
        )),
      }));
  }

  function _deriveAdmin(profilesData, previousAdmin) {
    const adminRow = (profilesData || []).find(p => p.role === 'admin' || p.role === 'teacher');
    return adminRow ? {
      id: adminRow.id, name: adminRow.display_name, role: 'Teacher',
      pass: previousAdmin?.pass ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin?.pass : 'admin123'),
    } : (previousAdmin ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin : null));
  }

  function _deriveEquippedTitles(profilesData) {
    const equippedTitles = {};
    (profilesData || []).forEach(p => {
      if (p.role === 'student' && p.equipped_title_id) equippedTitles[p.id] = p.equipped_title_id;
    });
    return equippedTitles;
  }

  function _deriveBossEvents(bossEventsData, lootClaimsData) {
    const bossIdById = {};
    const bossEventsArr = (bossEventsData || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((b, idx) => {
        bossIdById[b.id] = idx;
        return {
          _id: b.id, // kept so writes can map back; never read by legacy code
          classId: b.class_id || 'default-class', // Phase 14: section ownership
          name: b.name, description: b.description, image: b.image,
          maxHp: b.max_hp, currentHp: b.current_hp, status: b.status,
          startDate: b.start_date, endDate: b.end_date,
          defeatedAt: b.defeated_at ? Date.parse(b.defeated_at) : null, // Phase 26: was raw string, unlike its sibling timestamps
          endedAt: b.ended_at ? Date.parse(b.ended_at) : null, // Phase 24: was local-only before
          xpReward: b.xp_reward, coinReward: b.coin_reward,
          participationReward: b.participation_reward, victoryReward: b.victory_reward,
          defeatNarrTitle: b.defeat_narr_title, defeatNarrText: b.defeat_narr_text,
          victoryTitle: b.victory_title, victoryMessage: b.victory_message,
          lootRewards: b.loot_rewards || [], lootDuration: b.loot_duration_sec,
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
          skillFireMode: b.skill_fire_mode || undefined,
          skillIntervalMin: b.skill_interval_min || undefined,
          skillIntervalMax: b.skill_interval_max || undefined,
          rageSettings: b.rage_settings || {},
          phases: b.phases || [],
          lootClaims: (lootClaimsData || [])
            .filter(c => c.boss_id === b.id)
            .map(c => ({
              id: c.id, rewardId: c.reward_id, itemName: c.item_name, rarity: c.rarity,
              studentId: c.student_id, claimedAt: Date.parse(c.claimed_at),
              classId: c.class_id || 'default-class', // Phase 14: section ownership
              // Phase 44: claim_loot_reward() RPC now actually persists these —
              // restore them so the claim feed shows real names/colors after a
              // refresh instead of falling back to "Student" placeholders.
              studentName: c.student_name, studentInit: c.student_init, studentColor: c.student_color,
            })),
          createdAt: b.created_at ? Date.parse(b.created_at) : null,
        };
      });
    return { bossEventsArr, bossIdById };
  }

  function _deriveBossParticipants(bossParticipantsData, bossIdById) {
    const bossParticipantsObj = {};
    (bossParticipantsData || []).forEach(row => {
      const idx = bossIdById[row.boss_id];
      if (idx === undefined) return;
      if (!bossParticipantsObj[idx]) bossParticipantsObj[idx] = {};
      bossParticipantsObj[idx][row.student_id] = {
        studentId: row.student_id,
        classId: row.class_id || 'default-class', // Phase 14: section ownership
        totalDamage: row.total_damage, correctAnswers: row.correct_answers,
        wrongAnswers: row.wrong_answers, critHits: row.crit_hits,
        minionsDefeated: row.minions_defeated,
        joinTime: row.joined_at ? Date.parse(row.joined_at) : null,
        lastQIdx: row.last_question_idx,
      };
    });
    return bossParticipantsObj;
  }

  function _deriveAchievements(achievementsData) {
    // Phase 38: same starter-template filter as titlesArr/quizzesArr/campaignWorldsArr.
    return (achievementsData || []).filter(a => !a.is_starter_template).map(a => ({
      id: a.id, ownerTeacherId: a.owner_teacher_id, // Phase 32: catalog owner scoping
      name: a.name, description: a.description, icon: a.icon,
      category: a.category, rarity: a.rarity, xpReward: a.xp_reward,
      coinReward: a.coin_reward, triggerType: a.trigger_type,
      triggerValue: a.trigger_value, active: a.active,
    }));
  }

  function _deriveAchievementUnlocks(userAchievementsData) {
    const achievementUnlocks = {};
    (userAchievementsData || []).forEach(u => {
      if (!achievementUnlocks[u.student_id]) achievementUnlocks[u.student_id] = [];
      achievementUnlocks[u.student_id].push({
        achId: u.achievement_id, unlockedAt: u.unlocked_at,
        xpGranted: u.xp_granted, coinsGranted: u.coins_granted,
        claimed: u.claimed, claimedAt: u.claimed_at,
        classId: u.class_id || 'default-class', // Phase 14: section ownership
      });
    });
    return achievementUnlocks;
  }

  function _deriveTitles(titlesData) {
    // Phase 38: is_starter_template rows are admin-only starter-pack
    // templates — filtered here, not RLS, same reasoning as the original
    // inline version of this transform.
    return (titlesData || []).filter(t => !t.is_starter_template).map(t => ({
      id: t.id, ownerTeacherId: t.owner_teacher_id, // Phase 32: catalog owner scoping
      name: t.name, description: t.description, icon: t.icon,
      rarity: t.rarity, active: t.active !== false, achievementId: t.achievement_id,
      textColor: t.text_color, borderColor: t.border_color, glowColor: t.glow_color,
      bgColor: t.bg_color, primaryColor: t.primary_color, secondaryColor: t.secondary_color,
      gradientFrom: t.gradient_from, gradientTo: t.gradient_to, borderStyle: t.border_style,
      animation: t.animation, particles: t.particles, bgEffect: t.bg_effect,
      customBorderCSS: t.custom_border_css, customAnimationCSS: t.custom_animation_css,
      customBgCSS: t.custom_bg_css, createdAt: t.created_at,
      frameShape: t.frame_shape || 'classic', frameStyle: t.frame_style || 'none',
      accentColor: t.accent_color, effect: t.effect || 'none',
      frameTemplate: t.frame_template || 'solid',
    }));
  }

  function _deriveTitleUnlocks(titleUnlocksData) {
    const titleUnlocksObj = {};
    (titleUnlocksData || []).forEach(u => {
      if (!titleUnlocksObj[u.student_id]) titleUnlocksObj[u.student_id] = [];
      titleUnlocksObj[u.student_id].push(u.title_id);
    });
    return titleUnlocksObj;
  }

  function _deriveTitleSectionAssignments(titleSectionsData) {
    const titleSectionAssignments = {};
    (titleSectionsData || []).forEach(row => {
      if (!titleSectionAssignments[row.title_id]) titleSectionAssignments[row.title_id] = [];
      titleSectionAssignments[row.title_id].push(row.class_id);
    });
    return titleSectionAssignments;
  }

  function _deriveQuizzes(quizzesData) {
    // Phase 38: same starter-template filter as titlesArr above.
    return (quizzesData || []).filter(q => !q.is_starter_template).map(q => ({
      id: q.id, ownerTeacherId: q.owner_teacher_id, // Phase 32: catalog owner scoping
      title: q.title, desc: q.description,
      xpReward: q.xp_reward, coinReward: q.coin_reward, timeLimit: q.time_limit,
      rarity: q.rarity || 'Common', cadence: q.cadence || 'standing',
      chainId: q.chain_id || null, chainOrder: q.chain_order || 1, chainLabel: q.chain_label || '',
      startDate: q.start_date || null, endDate: q.end_date || null,
      stageTimers: Array.isArray(q.stage_timers) ? q.stage_timers : [null, null, null],
      questions: q.questions || [], active: q.active !== false,
      createdAt: q.created_at,
    }));
  }

  function _deriveCampaignWorlds(campaignWorldsData) {
    // Phase 38: same starter-template filter as titlesArr/quizzesArr above.
    return (campaignWorldsData || []).filter(w => !w.is_starter_template).map(w => ({
      id: w.id, ownerTeacherId: w.owner_teacher_id, // Phase 32: catalog owner scoping
      label: w.label, icon: w.icon, color: w.color, desc: w.description,
      stages: w.stages || [],
    }));
  }

  function _deriveCampaignSectionAssignments(campaignStageSectionsData, campaignWorldsArr) {
    const worldIdByStageId = {};
    (campaignWorldsArr || []).forEach(w => (w.stages || []).forEach(s => { worldIdByStageId[s.id] = w.id; }));
    const campaignSectionAssignments = {};
    (campaignStageSectionsData || []).forEach(row => {
      const worldId = worldIdByStageId[row.stage_id];
      if (!worldId) return; // stale row for a since-deleted stage — ignore
      if (!campaignSectionAssignments[worldId]) campaignSectionAssignments[worldId] = [];
      if (!campaignSectionAssignments[worldId].includes(row.class_id)) campaignSectionAssignments[worldId].push(row.class_id);
    });
    return campaignSectionAssignments;
  }

  function _deriveMail(mailMessagesData, profilesData, titlesArr) {
    const mailByBatch = {};
    (mailMessagesData || []).forEach(row => {
      const batchId = row.batch_id || row.id;
      if (!mailByBatch[batchId]) {
        const senderProfile = (profilesData || []).find(p => p.id === row.sender_teacher_id);
        const rewards = [];
        if (row.xp_reward)   rewards.push({ type: 'xp', amount: row.xp_reward, icon: '⚡', label: 'XP', color: 'var(--primary)' });
        if (row.coin_reward) rewards.push({ type: 'coins', amount: row.coin_reward, icon: '🪙', label: 'Coins', color: 'var(--tertiary)' });
        if (row.title_reward_id) {
          const t = (titlesArr || []).find(x => x.id === row.title_reward_id);
          rewards.push({ type: 'title', amount: 1, icon: (t && t.icon) || '🎖️', label: (t && t.name) || 'Title', color: '#EC4899', titleId: row.title_reward_id });
        }
        mailByBatch[batchId] = {
          id: batchId,
          subject: row.subject, body: row.body, type: row.mail_type || 'general',
          sender: senderProfile ? senderProfile.display_name : 'Teacher',
          hasReward: !!(row.xp_reward || row.coin_reward || row.title_reward_id),
          rewards,
          to: [],
          sentAt: row.created_at,
          readBy: {}, claimedBy: {},
          rowIdBySid: {},
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
    (quizSectionsData || []).forEach(row => {
      if (!quizSectionAssignments[row.quiz_id]) quizSectionAssignments[row.quiz_id] = [];
      quizSectionAssignments[row.quiz_id].push(row.class_id);
    });
    return quizSectionAssignments;
  }

  function _deriveAchievementSectionAssignments(achievementSectionsData) {
    const achievementSectionAssignments = {};
    (achievementSectionsData || []).forEach(row => {
      if (!achievementSectionAssignments[row.achievement_id]) achievementSectionAssignments[row.achievement_id] = [];
      achievementSectionAssignments[row.achievement_id].push(row.class_id);
    });
    return achievementSectionAssignments;
  }

  function _deriveInventory(inventoryRowsData) {
    const inventoryByStudent = {};
    (inventoryRowsData || []).forEach(row => {
      if (!inventoryByStudent[row.student_id]) inventoryByStudent[row.student_id] = [];
      inventoryByStudent[row.student_id].push({
        itemId: row.item_id, itemName: row.item_name, emoji: row.emoji, category: row.category,
        quantity: row.quantity, datePurchased: row.date_purchased, lastPurchased: row.last_purchased,
        source: row.source, status: row.status, usedAt: row.used_at,
      });
    });
    return inventoryByStudent;
  }

  function _deriveQuizHistory(quizHistoryRowsData) {
    const quizHistoryByStudent = {};
    const completedQuizzesByStudent = {};
    (quizHistoryRowsData || []).forEach(row => {
      if (!quizHistoryByStudent[row.student_id]) quizHistoryByStudent[row.student_id] = [];
      quizHistoryByStudent[row.student_id].push({
        id: row.id, quizId: row.quiz_id, score: row.score, attempt: row.attempt,
        completedAt: row.completed_at, date: row.date_label,
        results: Array.isArray(row.question_results) ? row.question_results : undefined,
        ...(row.learning_reward_version===1?{learningRewardVersion:1}:{}),
        aborted: !!row.aborted,
      });
      if (!row.aborted) {
        if (!completedQuizzesByStudent[row.student_id]) completedQuizzesByStudent[row.student_id] = new Set();
        completedQuizzesByStudent[row.student_id].add(row.quiz_id);
      }
    });
    return { quizHistoryByStudent, completedQuizzesByStudent };
  }

  function _deriveStudentSkills(studentSkillRowsData) {
    const studentSkillsObj = {};
    (studentSkillRowsData || []).forEach(row => {
      studentSkillsObj[row.student_id] = {
        hint: row.hint_count || 0, heal: row.heal_count || 0, shield: row.shield_count || 0,
      };
    });
    return studentSkillsObj;
  }

  function _derivePointLog(pointLogData) {
    return (pointLogData || []).map(p => ({
      id: p.id, studentId: p.student_id, what: p.what, pts: p.pts, when: p.when_label,
      createdAt: p.created_at,
    }));
  }

  function _deriveRedemptions(redemptionsData) {
    return (redemptionsData || []).map(r => ({
      orderId: r.order_id, studentId: r.student_id, itemId: r.item_id,
      itemName: r.item_name, emoji: r.emoji, item: r.item_label, pts: r.pts,
      date: r.date_label, time: r.time_label, claimCode: r.claim_code,
      createdAt: r.created_at,
    }));
  }

  function _deriveOrders(ordersData) {
    return (ordersData || []).map(o => ({
      orderId: o.order_id, claimCode: o.claim_code,
      studentId: o.student_id, studentName: o.student_name,
      studentInit: o.student_init, studentColor: o.student_color,
      itemId: o.item_id, itemName: o.item_name, emoji: o.emoji,
      cost: o.cost, category: o.category,
      status: o.status,
      createdAt: o.created_at, createdDateStr: o.created_date_str,
      claimedAt: o.claimed_at ? Date.parse(o.claimed_at) : null, claimedBy: o.claimed_by,
      cancelledAt: o.cancelled_at ? Date.parse(o.cancelled_at) : null,
      cancelReason: o.cancel_reason, cancelledBy: o.cancelled_by,
    }));
  }

  function _deriveNotifications(notificationsData) {
    return (notificationsData || []).map(n => ({
      id: n.id, studentId: n.student_id, type: n.type, icon: n.icon,
      title: n.title, body: n.body, action: n.action, pts: n.pts,
      sourceId: n.source_id, read: n.read, createdAt: n.created_at,
    }));
  }

  function _deriveRecitationLog(recitationLogData) {
    return (recitationLogData || []).map(r => ({
      id: r.id, studentId: r.student_id, pts: r.pts, note: r.note, when: r.when_label,
      classId: r.class_id || null, createdAt: r.created_at || null,
    }));
  }

  // Phase 71 — cross-device "Start Recitation Session" sync. Read-only
  // passthrough, same posture as recitationLog above: all writes to this
  // table go through start_recitation_session()/stop_recitation_session()
  // (SECURITY DEFINER RPCs, see recitation-service.js), never through the
  // bulk push path.
  function _deriveRecitationSessions(recitationSessionsData) {
    return (recitationSessionsData || []).map(s => ({
      id: s.id, classId: s.class_id, startedBy: s.started_by,
      startedAt: s.started_at, endedAt: s.ended_at || null, isActive: !!s.is_active,
    }));
  }

  function _deriveRfidCards(rfidCardsData) {
    return (rfidCardsData || []).map(c => ({
      id: c.id, tagId: c.tag_id, studentId: c.student_id,
      isActive: c.is_active, assignedAt: c.assigned_at, revokedAt: c.revoked_at,
    }));
  }

  function _deriveAttendanceSchedules(attendanceSchedulesData) {
    // Phase 54: dayOfWeek 0 = default/whole-week row, 1..7 = Mon..Sun
    // override (ISO weekday) — a class_id can now have up to 8 rows
    // instead of exactly 1. Fall back to 0 for any pre-migration row that
    // somehow arrives without it.
    // Phase 55: dayOff true on an override row means "no class at all that
    // day" — its openTime/startTime/etc are a placeholder, never meant to
    // be shown or scanned against.
    return (attendanceSchedulesData || []).map(s => ({
      id: s.id, classId: s.class_id, dayOfWeek: s.day_of_week ?? 0, dayOff: !!s.day_off,
      openTime: s.open_time, startTime: s.start_time,
      lateCutoff: s.late_cutoff, closeTime: s.close_time, active: s.active,
    }));
  }

  function _deriveAttendanceLogs(attendanceLogsData) {
    return (attendanceLogsData || []).map(a => ({
      id: a.id, studentId: a.student_id, classId: a.class_id, logDate: a.log_date,
      status: a.status, scannedAt: a.scanned_at, entryMethod: a.entry_method,
      rfidTag: a.rfid_tag, recordedBy: a.recorded_by, notes: a.notes,
    }));
  }

  function _deriveStore(shopProductsData) {
    // Phase 38: same starter-template filter as the other catalog tables.
    return (shopProductsData || []).filter(p => !p.is_starter_template).map(p => ({
      id: p.id, ownerTeacherId: p.owner_teacher_id,
      name: p.name, emoji: p.emoji, desc: p.description, cat: p.category,
      cost: p.cost, stock: p.stock, active: p.active,
      addedAt: p.created_at,
    }));
  }

  function _deriveRegistrations(registrationsData) {
    return (registrationsData || [])
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .map(r => ({
        id: r.id, firstName: r.first_name, lastName: r.last_name,
        username: r.username, email: r.email, studentId: r.student_id_text,
        gradeLevel: r.grade_level, section: r.section, classId: r.class_id, // Phase 33
        status: r.status, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by, rejectionReason: r.rejection_reason,
        approvedStudentId: r.approved_student_id,
      }));
  }


// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._deriveStudents = _deriveStudents;
window._deriveAdmin = _deriveAdmin;
window._deriveEquippedTitles = _deriveEquippedTitles;
window._deriveBossEvents = _deriveBossEvents;
window._deriveBossParticipants = _deriveBossParticipants;
window._deriveAchievements = _deriveAchievements;
window._deriveAchievementUnlocks = _deriveAchievementUnlocks;
window._HISTORY_LIMITS = _HISTORY_LIMITS;
window._derivePointLog = _derivePointLog;
window._deriveRecitationLog = _deriveRecitationLog;
window._deriveRfidCards = _deriveRfidCards;
window._deriveAttendanceLogs = _deriveAttendanceLogs;
window._deriveMail = _deriveMail;
window._deriveQuizSectionAssignments = _deriveQuizSectionAssignments;
window._deriveAchievementSectionAssignments = _deriveAchievementSectionAssignments;
window._deriveTitles = _deriveTitles;
window._deriveTitleUnlocks = _deriveTitleUnlocks;
window._deriveTitleSectionAssignments = _deriveTitleSectionAssignments;
window._deriveQuizzes = _deriveQuizzes;
window._deriveCampaignWorlds = _deriveCampaignWorlds;
window._deriveCampaignSectionAssignments = _deriveCampaignSectionAssignments;
window._deriveOrders = _deriveOrders;
window._deriveInventory = _deriveInventory;
window._deriveQuizHistory = _deriveQuizHistory;
window._deriveNotifications = _deriveNotifications;
window._deriveStudentSkills = _deriveStudentSkills;
window._deriveRecitationSessions = _deriveRecitationSessions;
window._deriveStore = _deriveStore;
window._deriveRegistrations = _deriveRegistrations;
window._deriveRedemptions = _deriveRedemptions;
window._deriveAttendanceSchedules = _deriveAttendanceSchedules;
